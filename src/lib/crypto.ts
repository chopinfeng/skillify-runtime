/**
 * Envelope encryption: one AES-256-GCM "DEK" per tenant, generated once at
 * tenant creation, itself encrypted at rest by a root "KEK" (a Worker
 * secret, `KEK_BASE64`). Connected-account secrets are encrypted with the
 * tenant's plaintext DEK, which only ever exists in Worker memory for the
 * lifetime of a single request.
 */

const IV_LENGTH = 12;

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function aesEncrypt(rawKey: Uint8Array, plaintext: Uint8Array): Promise<string> {
  const key = await importAesKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  const blob = new Uint8Array(iv.length + ciphertext.length);
  blob.set(iv, 0);
  blob.set(ciphertext, iv.length);
  return toBase64(blob);
}

async function aesDecrypt(rawKey: Uint8Array, blobB64: string): Promise<Uint8Array> {
  const blob = fromBase64(blobB64);
  const iv = blob.slice(0, IV_LENGTH);
  const ciphertext = blob.slice(IV_LENGTH);
  const key = await importAesKey(rawKey);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new Uint8Array(plaintext);
}

export function generateDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function wrapDek(dek: Uint8Array, kekBase64: string): Promise<string> {
  return aesEncrypt(fromBase64(kekBase64), dek);
}

export async function unwrapDek(wrapped: string, kekBase64: string): Promise<Uint8Array> {
  return aesDecrypt(fromBase64(kekBase64), wrapped);
}

export async function encryptSecret(dek: Uint8Array, secret: Record<string, unknown>): Promise<string> {
  const plaintext = new TextEncoder().encode(JSON.stringify(secret));
  return aesEncrypt(dek, plaintext);
}

export async function decryptSecret(dek: Uint8Array, blobB64: string): Promise<Record<string, unknown>> {
  const plaintext = await aesDecrypt(dek, blobB64);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomId(prefix: string): string {
  return `${prefix}_${toBase64(crypto.getRandomValues(new Uint8Array(18))).replace(/[+/=]/g, "").slice(0, 24)}`;
}

export function randomApiKey(): string {
  return `sk_live_${toBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, "")}`;
}
