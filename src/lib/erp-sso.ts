import crypto from "crypto";
import { ApiError } from "@/lib/api-response";

// Passwordless sign-in from the RGIPT ERP/CRM ("Login with Quiz Panel").
//
// The ERP backend builds a small JSON document, encrypts it with the secret
// it shares with this app and sends the user to /api/auth/erp-sso?token=...
//
//   plaintext : {"email": "...", "roll": "...", "phone": "...", "ts": <unix seconds>, "nonce": "<random, 16+ chars>"}
//   algorithm : AES-256-GCM (authenticated - a token that was not produced
//               with the shared secret cannot decrypt, so it also proves the
//               caller is the ERP)
//   token     : base64url( iv[12 bytes] || authTag[16 bytes] || ciphertext )
//   key       : ERP_SSO_SECRET - 64 hex characters (32 bytes)
//
// A token is valid for SSO_MAX_AGE_SECONDS and can be redeemed once.
const SSO_MAX_AGE_SECONDS = 120;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export interface ErpSsoClaims {
  email: string;
  roll: string;
  phone: string;
}

function getKey(): Buffer {
  const hex = process.env.ERP_SSO_SECRET;
  if (!hex) throw new ApiError(503, "ERP single sign-on is not configured");
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) throw new ApiError(503, "ERP single sign-on is misconfigured");
  return key;
}

// Redeemed nonces, kept until their token would have expired anyway.
const usedNonces = new Map<string, number>();

function rememberNonce(nonce: string, nowSeconds: number): boolean {
  for (const [key, expiresAt] of usedNonces) {
    if (expiresAt <= nowSeconds) usedNonces.delete(key);
  }
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, nowSeconds + SSO_MAX_AGE_SECONDS * 2);
  return true;
}

const INVALID = () => new ApiError(401, "Invalid or expired sign-in link");

export function verifyErpSsoToken(token: string): ErpSsoClaims {
  const key = getKey();

  let claims: Record<string, unknown>;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length <= IV_LENGTH + TAG_LENGTH) throw new Error("too short");
    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = raw.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    claims = JSON.parse(plain);
  } catch {
    throw INVALID();
  }

  const { email, roll, phone, ts, nonce } = claims as Record<string, unknown>;
  if (typeof roll !== "string" || !roll.trim()) throw INVALID();
  if (typeof ts !== "number" || typeof nonce !== "string" || nonce.length < 16) throw INVALID();

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > SSO_MAX_AGE_SECONDS) throw INVALID();
  if (!rememberNonce(nonce, nowSeconds)) throw INVALID();

  return {
    roll: roll.trim(),
    email: typeof email === "string" ? email.trim() : "",
    phone: typeof phone === "string" ? phone.trim() : "",
  };
}

const normaliseEmail = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
// Last 10 digits - tolerates +91 / 0 prefixes and spaces/dashes.
const normalisePhone = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "").slice(-10);

// The roll identifies the account; email/phone from the ERP are a second
// check that the ERP and this system are talking about the same person. Each
// value the ERP sent must match what's on record (a value the record doesn't
// have can't be checked and is ignored), and at least one must be positively
// confirmed - so a roll alone is never enough.
export function claimsMatchAccount(
  claims: ErpSsoClaims,
  account: { email: string | null | undefined; mobile: string | null | undefined },
): boolean {
  let confirmed = 0;

  if (claims.email) {
    const recorded = normaliseEmail(account.email);
    if (recorded) {
      if (recorded !== normaliseEmail(claims.email)) return false;
      confirmed++;
    }
  }

  if (claims.phone) {
    const recorded = normalisePhone(account.mobile);
    if (recorded) {
      if (recorded !== normalisePhone(claims.phone)) return false;
      confirmed++;
    }
  }

  return confirmed > 0;
}
