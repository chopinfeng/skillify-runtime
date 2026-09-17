import { fromBase64, toBase64 } from "./crypto";

/**
 * PBKDF2-HMAC-SHA256 via native Web Crypto — no bcrypt/scrypt binding is
 * available in the Workers runtime, and PBKDF2 is natively supported, so
 * it avoids pulling in a WASM dependency for this. Iteration count follows
 * OWASP's current PBKDF2-SHA256 recommendation, capped at 100,000 — the
 * Workers runtime's WebCrypto PBKDF2 implementation rejects anything above
 * that with `NotSupportedError` (confirmed in production; local Miniflare
 * doesn't enforce the same cap, so this only surfaces once deployed).
 */
const ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const KEY_LENGTH_BITS = 256;

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    KEY_LENGTH_BITS,
  );
  return new Uint8Array(bits);
}

/** Stored format: `pbkdf2$<iterations>$<saltB64>$<hashB64>` — the
 * iteration count travels with the hash so a future parameter bump doesn't
 * invalidate existing passwords. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const derived = await deriveBits(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = fromBase64(parts[2]);
  const expected = fromBase64(parts[3]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const actual = await deriveBits(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}

/** For an OAuth-only signup (see routes/oauth-google.ts): `users.password_hash`
 * is NOT NULL and SQLite can't cheaply drop that constraint, so a Google-only
 * account gets a normal PBKDF2 hash of unguessable random bytes instead of a
 * real password. `verifyPassword` against it always returns false — there's
 * nothing special-cased about it, it's just a hash nobody typed. */
export async function unusablePasswordHash(): Promise<string> {
  return hashPassword(toBase64(crypto.getRandomValues(new Uint8Array(32))));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
