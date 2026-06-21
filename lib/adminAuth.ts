import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const adminSessionCookie = "detailx_admin_session";

type AdminSession = {
  email: string;
  expiresAt: number;
};

const sessionDays = 7;
const requiredAdminEnvVars = ["ADMIN_EMAIL", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"] as const;

export type AdminAuthConfigStatus = {
  configured: boolean;
  missing: string[];
};

export function getAdminAuthConfigStatus(): AdminAuthConfigStatus {
  const missing = requiredAdminEnvVars.filter((key) => !process.env[key]);
  return {
    configured: missing.length === 0,
    missing,
  };
}

export async function getAdminSession() {
  try {
    const config = getAdminAuthConfigStatus();
    if (!config.configured) {
      console.error("Admin auth is not configured.", { missing: config.missing });
      return null;
    }

    const cookieStore = await cookies();
    const token = cookieStore.get(adminSessionCookie)?.value;
    const session = verifyAdminSessionToken(token);
    console.info("Admin session check completed", { hasToken: Boolean(token), valid: Boolean(session) });
    return session;
  } catch (error) {
    console.error("Admin session check failed safely.", { error });
    return null;
  }
}

export function validateAdminCredentials(email: string, password: string) {
  const config = getAdminAuthConfigStatus();
  const expectedEmail = process.env.ADMIN_EMAIL;
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (!config.configured || !expectedEmail || !expectedPassword) {
    console.error("Admin login rejected because auth is not configured.", { missing: config.missing });
    return false;
  }

  const valid = email.trim().toLowerCase() === expectedEmail.trim().toLowerCase() && password === expectedPassword;
  console.info("Admin credential validation completed", { email: email.trim().toLowerCase(), valid });
  return valid;
}

export function createAdminSessionToken(email: string) {
  const secret = getAdminSessionSecret();
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is required to create an admin session.");
  }

  const expiresAt = Date.now() + sessionDays * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ email, expiresAt } satisfies AdminSession)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function setAdminSessionCookie(response: NextResponse, email: string) {
  response.cookies.set(adminSessionCookie, createAdminSessionToken(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionDays * 24 * 60 * 60,
    path: "/",
  });
}

export function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.set(adminSessionCookie, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
}

export function isAdminRequest(request: Request) {
  const cookieToken = parseCookieHeader(request.headers.get("cookie")).get(adminSessionCookie);
  if (verifyAdminSessionToken(cookieToken)) {
    return true;
  }

  const legacyKey = process.env.ADMIN_SCHEDULE_KEY;
  return Boolean(legacyKey && request.headers.get("x-admin-key") === legacyKey);
}

export function adminUnauthorizedResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: "Admin access is not configured or the session is invalid.",
    },
    { status: 401 }
  );
}

function verifyAdminSessionToken(token: string | undefined | null): AdminSession | null {
  const secret = getAdminSessionSecret();
  if (!token || !secret) {
    return null;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AdminSession;
    if (!session.email || !session.expiresAt || session.expiresAt < Date.now()) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function getAdminSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || "";
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function parseCookieHeader(header: string | null) {
  const cookiesMap = new Map<string, string>();
  if (!header) {
    return cookiesMap;
  }

  header.split(";").forEach((part) => {
    const [name, ...value] = part.trim().split("=");
    if (name) {
      cookiesMap.set(name, decodeURIComponent(value.join("=")));
    }
  });

  return cookiesMap;
}
