import type { Env } from "../types";
import { createTenantApiKey, createTenantWithDek, createUser, getUserByEmail } from "../db";
import { hashPassword, verifyPassword } from "../lib/password";
import { clearedSessionCookie, createSessionCookie, resolveSession, revokeCurrentSession } from "../lib/session";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

interface Credentials {
  email?: string;
  password?: string;
}

/** Self-serve signup: one user = one new tenant (see plan — team/shared
 * tenants are out of scope for this round). The API key is shown once
 * here, same as the admin bootstrap route (routes/tenants.ts) — there's no
 * console yet to look it up again later. */
export async function handleSignup(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Credentials;
  const email = body.email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return Response.json({ error: "a valid email is required" }, { status: 400 });
  if (!body.password || body.password.length < MIN_PASSWORD_LENGTH) {
    return Response.json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 });
  }
  if (await getUserByEmail(env, email)) return Response.json({ error: "email already registered" }, { status: 409 });

  const tenant = await createTenantWithDek(env, email);
  const user = await createUser(env, tenant.id, email, await hashPassword(body.password));
  const { plaintextKey } = await createTenantApiKey(env, tenant.id);
  const cookie = await createSessionCookie(env, user.id);

  return new Response(
    JSON.stringify({ user_id: user.id, email: user.email, tenant_id: tenant.id, api_key: plaintextKey }),
    { status: 201, headers: { "Content-Type": "application/json", "Set-Cookie": cookie } },
  );
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Credentials;
  const email = body.email?.trim().toLowerCase();

  // Same 401 whether the email doesn't exist or the password is wrong —
  // don't let the endpoint be used to enumerate registered emails.
  const invalid = () => Response.json({ error: "invalid email or password" }, { status: 401 });
  if (!email || !body.password) return invalid();

  const user = await getUserByEmail(env, email);
  if (!user || !(await verifyPassword(body.password, user.password_hash))) return invalid();

  const cookie = await createSessionCookie(env, user.id);
  return new Response(JSON.stringify({ user_id: user.id, email: user.email, tenant_id: user.tenant_id }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
  });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  await revokeCurrentSession(request, env);
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedSessionCookie() } });
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ user_id: session.user.id, email: session.user.email, tenant_id: session.tenant.id });
}
