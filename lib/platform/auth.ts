import {
  randomBytes,
  randomUUID,
  createHash,
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { query, transaction } from "./db";
import type { Session, Role } from "./types";
export const sessionCookie = "wl_session";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function passwordHash(value: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(value, salt, 64).toString("hex");
}
export function passwordMatches(value: string, stored: string) {
  try {
    const [salt, key] = stored.split(":");
    const derived = scryptSync(value, salt, 64);
    const expected = Buffer.from(key, "hex");
    return (
      derived.length === expected.length && timingSafeEqual(derived, expected)
    );
  } catch {
    return false;
  }
}
export async function rateLimit(key: string, limit = 20, seconds = 60) {
  const rows = await query<{ count: number }>(
    `INSERT INTO wl.rate_limits(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second')
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN wl.rate_limits.expires_at<now() THEN 1 ELSE wl.rate_limits.count+1 END,
 expires_at=CASE WHEN wl.rate_limits.expires_at<now() THEN now()+$2*interval '1 second' ELSE wl.rate_limits.expires_at END RETURNING count`,
    [hash(key), seconds],
  );
  if (rows[0].count > limit)
    throw new AppError("Too many requests. Please try again shortly.", 429);
}
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== new URL(request.url).origin &&
    origin !== process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "")
  )
    throw new AppError("Invalid request origin.", 403);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site")
    throw new AppError("Invalid request origin.", 403);
}
export function requestIP(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  );
}
export async function sessionFromToken(token: string): Promise<Session | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return (
    (
      await query<Session>(
        `SELECT s.id,u.id user_id,u.name,u.email,u.role FROM wl.sessions s JOIN wl.users u ON u.id=s.user_id
 WHERE s.id=$1 AND s.expires_at>now() AND u.active=true`,
        [hash(token)],
      )
    )[0] || null
  );
}
export async function requestSession(request: Request) {
  const token =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(sessionCookie + "="))
      ?.slice(sessionCookie.length + 1) || "";
  return sessionFromToken(token);
}
export const access: Record<string, Role[]> = {
  dashboard: ["owner", "admin", "manager"],
  bookings: ["owner", "admin", "manager", "staff"],
  calendar: ["owner", "admin", "manager", "staff"],
  customers: ["owner", "admin", "manager"],
  leads: ["owner", "admin", "manager"],
  services: ["owner", "admin", "manager"],
  marketing: ["owner", "admin"],
  messages: ["owner", "admin", "manager"],
  reviews: ["owner", "admin", "manager"],
  gallery: ["owner", "admin", "manager"],
  analytics: ["owner", "admin"],
  settings: ["owner", "admin"],
  team: ["owner"],
  payments: ["owner", "admin", "manager"],
};
export async function requireSession(request: Request, section = "bookings") {
  const s = await requestSession(request);
  if (!s) throw new AppError("Please sign in.", 401);
  if (!access[section]?.includes(s.role))
    throw new AppError("Your role does not have access to this area.", 403);
  if (!["GET", "HEAD"].includes(request.method)) assertOrigin(request);
  return s;
}
export async function login(email: string, password: string, ip: string) {
  await rateLimit("login-ip:" + ip, 30, 900);
  await rateLimit("login:" + email.toLowerCase(), 8, 900);
  const u = (
    await query<{ id: string; password_hash: string }>(
      "SELECT id,password_hash FROM wl.users WHERE email=$1 AND active=true",
      [email.toLowerCase().trim()],
    )
  )[0];
  if (!u || !passwordMatches(password, u.password_hash))
    throw new AppError("Invalid email or password.", 401);
  const token = randomBytes(32).toString("hex");
  await query(
    "INSERT INTO wl.sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [hash(token), u.id],
  );
  return token;
}
export async function logout(request: Request) {
  const s = await requestSession(request);
  if (s) await query("DELETE FROM wl.sessions WHERE id=$1", [s.id]);
}
export async function receiptKey() {
  if (
    process.env.ADMIN_SESSION_SECRET?.length &&
    process.env.ADMIN_SESSION_SECRET.length >= 32
  )
    return process.env.ADMIN_SESSION_SECRET;
  if (process.env.NODE_ENV === "production")
    throw new AppError(
      "ADMIN_SESSION_SECRET must contain at least 32 characters.",
      503,
    );
  await query(
    "INSERT INTO wl.settings(key,value) VALUES('receipt_key',$1::jsonb) ON CONFLICT DO NOTHING",
    [JSON.stringify(randomBytes(32).toString("hex"))],
  );
  return (
    await query<{ value: string }>(
      "SELECT value FROM wl.settings WHERE key='receipt_key'",
    )
  )[0].value;
}
export async function receiptToken(id: string) {
  return createHmac("sha256", await receiptKey())
    .update("receipt:" + id)
    .digest("hex");
}
export async function verifyReceipt(id: string, token: string) {
  const expected = await receiptToken(id);
  return (
    /^[a-f0-9]{64}$/.test(token) &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  );
}
export async function createReset(email: string, ip: string) {
  await rateLimit("reset:" + ip, 8, 900);
  const user = (
    await query<{ id: string }>(
      "SELECT id FROM wl.users WHERE email=$1 AND active=true",
      [email.toLowerCase().trim()],
    )
  )[0];
  if (!user) return null;
  const token = randomBytes(32).toString("hex");
  await query(
    "INSERT INTO wl.password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
    [hash(token), user.id],
  );
  return token;
}
export async function resetPassword(token: string, password: string) {
  if (password.length < 12 || password.length > 128)
    throw new AppError("Use a password between 12 and 128 characters.");
  await transaction(async (q) => {
    const r = (
      await q<{ user_id: string }>(
        "UPDATE wl.password_resets SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING user_id",
        [hash(token)],
      )
    ).rows[0];
    if (!r) throw new AppError("This reset link is invalid or expired.");
    await q(
      "UPDATE wl.users SET password_hash=$1,updated_at=now() WHERE id=$2",
      [passwordHash(password), r.user_id],
    );
    await q("DELETE FROM wl.sessions WHERE user_id=$1", [r.user_id]);
  });
}
export async function addUser(input: {
  name: string;
  email: string;
  password: string;
  role: Role;
}) {
  if (input.password.length < 12)
    throw new AppError("Use a password of at least 12 characters.");
  await query(
    "INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
    [
      randomUUID(),
      input.name,
      input.email.toLowerCase().trim(),
      passwordHash(input.password),
      input.role,
    ],
  );
}
