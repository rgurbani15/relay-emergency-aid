const enc = new TextEncoder();

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const uuid = () => crypto.randomUUID();
export const shortId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function base32(bytes: Uint8Array, len: number): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5 && out.length < len) { out += CROCKFORD[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.slice(0, len);
}

export async function hmacBase32(secret: string, message: string, len = 8): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return base32(sig, len);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
