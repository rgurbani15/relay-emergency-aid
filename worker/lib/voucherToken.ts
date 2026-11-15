import { hmacBase32, timingSafeEqual } from "./crypto";

/** Signed voucher credential: `VCH-0001-K7Q2M9XA`. The QR code and the manual-entry code are the same string.
 * It carries only the public voucher code and a 40-bit HMAC over (code | nonce) - no resident data, no secret. */
export async function signVoucher(secret: string, publicCode: string, nonce: string): Promise<string> {
  return `${publicCode}-${await hmacBase32(secret, `${publicCode}|${nonce}`)}`;
}

export function parseVoucherToken(raw: string): { code: string; sig: string } | null {
  const t = raw.trim().toUpperCase().replace(/\s+/g, "");
  const m = /^(VCH-[A-Z0-9]{4,12})-([0-9A-Z]{8})$/.exec(t);
  return m ? { code: m[1], sig: m[2] } : null;
}

export async function verifyVoucherSignature(secret: string, code: string, nonce: string, sig: string): Promise<boolean> {
  return timingSafeEqual(await hmacBase32(secret, `${code}|${nonce}`), sig);
}
