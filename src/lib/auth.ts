import "server-only";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

const secretEnv = process.env.JWT_SECRET;
if (!secretEnv) {
  throw new Error("JWT_SECRET is not set. Add it to your .env file.");
}
const secret = new TextEncoder().encode(secretEnv);

export const SESSION_COOKIE = "thesissync_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionRole = "STUDENT" | "SUPERVISOR" | "ADMIN";

export type SessionPayload = {
  sub: string; // user id
  email: string;
  role: SessionRole;
  name: string;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, role: payload.role, name: payload.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      sub: payload.sub as string,
      email: payload.email as string,
      role: payload.role as SessionRole,
      name: payload.name as string,
    };
  } catch {
    return null;
  }
}

/** Reads and verifies the session cookie inside a Server Component / Route Handler. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
