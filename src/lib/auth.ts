import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api-response";

export type UserRole = "admin" | "faculty" | "student";

export interface AuthTokenPayload {
  sub: number | string; // admin: numeric id; faculty/student: legacy roll string
  role: UserRole;
  email: string;
  name: string;
  adminRole?: "super_admin" | "admin";
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me";
const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY ?? "15m";
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY ?? "7d";

const BCRYPT_COST = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRY } as SignOptions);
}

export function signRefreshToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY } as SignOptions);
}

export function verifyAccessToken(token: string): AuthTokenPayload {
  try {
    return jwt.verify(token, ACCESS_SECRET) as unknown as AuthTokenPayload;
  } catch {
    throw new ApiError(401, "Invalid or expired access token");
  }
}

export function verifyRefreshToken(token: string): AuthTokenPayload {
  try {
    return jwt.verify(token, REFRESH_SECRET) as unknown as AuthTokenPayload;
  } catch {
    throw new ApiError(401, "Invalid or expired refresh token");
  }
}

export async function hashToken(token: string): Promise<string> {
  return bcrypt.hash(token, BCRYPT_COST);
}

export async function compareToken(token: string, hash: string): Promise<boolean> {
  return bcrypt.compare(token, hash);
}

export function getBearerToken(req: NextRequest): string {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  const cookieToken = req.cookies.get("accessToken")?.value;
  if (cookieToken) return cookieToken;
  throw new ApiError(401, "Missing or malformed Authorization header");
}

// True when the caller authenticated with an `Authorization: Bearer` header
// (the mobile app) rather than the browser session cookie the web panel uses.
export function usesBearerAuth(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  return !!header?.startsWith("Bearer ");
}

// Starting/stopping a quiz is a faculty-app-only action (client requirement):
// a faculty member's web-panel (cookie) session is refused, while the app
// (Bearer token) and an admin override are unaffected. Set
// ALLOW_WEB_QUIZ_CONTROL=true to lift the restriction without a code change.
export function assertQuizControlAllowed(req: NextRequest, user: AuthTokenPayload): void {
  if (user.role !== "faculty") return;
  if (process.env.ALLOW_WEB_QUIZ_CONTROL === "true") return;
  if (!usesBearerAuth(req)) {
    throw new ApiError(403, "Quizzes can only be started or stopped from the faculty mobile app");
  }
}

export function getAuthUser(req: NextRequest): AuthTokenPayload {
  const token = getBearerToken(req);
  return verifyAccessToken(token);
}

export function requireRole(user: AuthTokenPayload, ...roles: UserRole[]): void {
  if (!roles.includes(user.role)) {
    throw new ApiError(403, "You do not have permission to perform this action");
  }
}

export function requireSuperAdmin(user: AuthTokenPayload): void {
  if (user.role !== "admin" || user.adminRole !== "super_admin") {
    throw new ApiError(403, "Only a super admin can perform this action");
  }
}

export function tokenPayloadFromUser(user: {
  id: number | string;
  email: string;
  name: string;
  role?: string;
}, roleKind: UserRole): AuthTokenPayload {
  return {
    sub: user.id,
    role: roleKind,
    email: user.email,
    name: user.name,
    ...(roleKind === "admin" ? { adminRole: (user.role as "super_admin" | "admin") ?? "admin" } : {}),
  };
}
