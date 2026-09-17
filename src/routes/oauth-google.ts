import type { Env } from "../types";
import { createOAuthIdentity, createTenantWithDek, createUser, getUserByEmail, getUserByOAuthIdentity } from "../db";
import { unusablePasswordHash } from "../lib/password";
import { createSessionCookie, readCookie } from "../lib/session";
import { toBase64 } from "../lib/crypto";

const STATE_COOKIE = "sf_oauth_state";
const STATE_TTL_SECONDS = 600; // 10 min — just long enough for the redirect round trip

function redirectUriFor(request: Request): string {
  return `${new URL(request.url).origin}/v1/auth/google/callback`;
}

function notConfigured(): Response {
  return Response.json(
    { error: "Google login is not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET unset)" },
    { status: 501 },
  );
}

/** Redirects to Google's consent screen. The CSRF `state` is a random value
 * carried two ways — as the OAuth `state` param, and in a short-lived
 * HttpOnly cookie — so the callback can confirm the response actually
 * belongs to a redirect *this* server issued, not a forged callback hit. */
export async function handleGoogleStart(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID) return notConfigured();

  const state = toBase64(crypto.getRandomValues(new Uint8Array(24)));
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUriFor(request),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "Set-Cookie": `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${STATE_TTL_SECONDS}`,
    },
  });
}

interface GoogleUserinfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/** Exchanges the auth code for tokens, then calls Google's userinfo
 * endpoint with the resulting access_token rather than verifying the
 * id_token's JWT signature ourselves (which would mean fetching and
 * caching Google's JWKS and doing our own RS256 verification). The access
 * token was obtained via a direct, client-secret-authenticated, TLS call to
 * Google — trusting Google's own answer for that token is sound, and it's
 * a meaningfully smaller amount of security-critical code to get right. */
async function fetchGoogleUserinfo(env: Env, code: string, redirectUri: string): Promise<GoogleUserinfo> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokenBody = (await tokenResponse.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error(`Google token exchange failed: ${tokenBody.error ?? tokenResponse.status} ${tokenBody.error_description ?? ""}`);
  }

  const userinfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  if (!userinfoResponse.ok) throw new Error(`Google userinfo fetch failed: ${userinfoResponse.status}`);
  return userinfoResponse.json();
}

export async function handleGoogleCallback(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return notConfigured();

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = readCookie(request, STATE_COOKIE);
  if (!code || !state || !cookieState || state !== cookieState) {
    return Response.json({ error: "invalid or missing OAuth state" }, { status: 400 });
  }

  let profile: GoogleUserinfo;
  try {
    profile = await fetchGoogleUserinfo(env, code, redirectUriFor(request));
  } catch (err) {
    return Response.json({ error: String((err as Error).message ?? err) }, { status: 502 });
  }
  if (!profile.email || !profile.email_verified) {
    return Response.json({ error: "Google account has no verified email" }, { status: 400 });
  }
  const email = profile.email.toLowerCase();

  let user = await getUserByOAuthIdentity(env, "google", profile.sub);
  if (!user) {
    const existing = await getUserByEmail(env, email);
    if (existing) {
      // Same verified email as an existing password-based account — link
      // rather than create a duplicate. Google having verified the email
      // is exactly the trust signal that makes this safe.
      await createOAuthIdentity(env, existing.id, "google", profile.sub);
      user = existing;
    } else {
      const tenant = await createTenantWithDek(env, email);
      user = await createUser(env, tenant.id, email, await unusablePasswordHash());
      await createOAuthIdentity(env, user.id, "google", profile.sub);
    }
  }

  const sessionCookie = await createSessionCookie(env, user.id);
  const headers = new Headers({ Location: "/console" });
  headers.append("Set-Cookie", sessionCookie);
  headers.append("Set-Cookie", `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}
