import type { Env } from "../types";
import { createOAuthIdentity, createTenantWithDek, createUser, getUserByEmail, getUserByOAuthIdentity } from "../db";
import { unusablePasswordHash } from "../lib/password";
import { createSessionCookie, readCookie } from "../lib/session";
import { toBase64 } from "../lib/crypto";

const STATE_COOKIE = "sf_oauth_state";
const STATE_TTL_SECONDS = 600; // 10 min — just long enough for the redirect round trip
const PROVIDER = "auth0";

function redirectUriFor(request: Request): string {
  return `${new URL(request.url).origin}/v1/auth/auth0/callback`;
}

function notConfigured(): Response {
  return Response.json(
    { error: "Auth0 login is not configured (AUTH0_DOMAIN/AUTH0_CLIENT_ID/AUTH0_CLIENT_SECRET unset)" },
    { status: 501 },
  );
}

/** Redirects to Auth0's Universal Login. The CSRF `state` is a random value
 * carried two ways — as the OAuth `state` param, and in a short-lived
 * HttpOnly cookie — so the callback can confirm the response actually
 * belongs to a redirect *this* server issued, not a forged callback hit. */
export async function handleAuth0Start(request: Request, env: Env): Promise<Response> {
  if (!env.AUTH0_DOMAIN || !env.AUTH0_CLIENT_ID) return notConfigured();

  const state = toBase64(crypto.getRandomValues(new Uint8Array(24)));
  const params = new URLSearchParams({
    client_id: env.AUTH0_CLIENT_ID,
    redirect_uri: redirectUriFor(request),
    response_type: "code",
    scope: "openid email profile",
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://${env.AUTH0_DOMAIN}/authorize?${params}`,
      "Set-Cookie": `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${STATE_TTL_SECONDS}`,
    },
  });
}

interface Auth0Userinfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/** Exchanges the auth code for tokens, then calls Auth0's own /userinfo
 * endpoint with the resulting access_token rather than verifying the
 * id_token's JWT signature ourselves — same reasoning as the Google
 * integration this replaced: the access token already came from a
 * client-secret-authenticated call to Auth0 over TLS, so trusting Auth0's
 * own answer for it is sound and avoids a JWKS-fetching RS256 verifier. */
async function fetchAuth0Userinfo(env: Env, code: string, redirectUri: string): Promise<Auth0Userinfo> {
  const tokenResponse = await fetch(`https://${env.AUTH0_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: env.AUTH0_CLIENT_ID,
      client_secret: env.AUTH0_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenBody = (await tokenResponse.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error(`Auth0 token exchange failed: ${tokenBody.error ?? tokenResponse.status} ${tokenBody.error_description ?? ""}`);
  }

  const userinfoResponse = await fetch(`https://${env.AUTH0_DOMAIN}/userinfo`, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  if (!userinfoResponse.ok) throw new Error(`Auth0 userinfo fetch failed: ${userinfoResponse.status}`);
  return userinfoResponse.json();
}

export async function handleAuth0Callback(request: Request, env: Env): Promise<Response> {
  if (!env.AUTH0_DOMAIN || !env.AUTH0_CLIENT_ID || !env.AUTH0_CLIENT_SECRET) return notConfigured();

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = readCookie(request, STATE_COOKIE);
  if (!code || !state || !cookieState || state !== cookieState) {
    return Response.json({ error: "invalid or missing OAuth state" }, { status: 400 });
  }

  let profile: Auth0Userinfo;
  try {
    profile = await fetchAuth0Userinfo(env, code, redirectUriFor(request));
  } catch (err) {
    return Response.json({ error: String((err as Error).message ?? err) }, { status: 502 });
  }
  if (!profile.email || !profile.email_verified) {
    return Response.json({ error: "Auth0 account has no verified email" }, { status: 400 });
  }
  const email = profile.email.toLowerCase();

  // profile.sub already disambiguates the underlying connection Auth0
  // federated to (e.g. "google-oauth2|108...", "auth0|abc123" for its own
  // database connection) — provider="auth0" + that sub is precise enough,
  // no need to track the sub-provider separately.
  let user = await getUserByOAuthIdentity(env, PROVIDER, profile.sub);
  if (!user) {
    const existing = await getUserByEmail(env, email);
    if (existing) {
      // Same verified email as an existing password-based account — link
      // rather than create a duplicate. Auth0 having verified the email
      // is exactly the trust signal that makes this safe.
      await createOAuthIdentity(env, existing.id, PROVIDER, profile.sub);
      user = existing;
    } else {
      const tenant = await createTenantWithDek(env, email);
      user = await createUser(env, tenant.id, email, await unusablePasswordHash());
      await createOAuthIdentity(env, user.id, PROVIDER, profile.sub);
    }
  }

  const sessionCookie = await createSessionCookie(env, user.id);
  const headers = new Headers({ Location: "/console" });
  headers.append("Set-Cookie", sessionCookie);
  headers.append("Set-Cookie", `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}
