import type { ZodType } from "zod";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}
export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found`);
export const forbidden = (message = "You do not have permission to do that") => new HttpError(403, "forbidden", message);
export const conflict = (message: string, code = "conflict", details?: unknown) => new HttpError(409, code, message, details);

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new HttpError(400, "validation_error", issues.map((i) => `${i.path ? i.path + ": " : ""}${i.message}`).join("; "), issues);
  }
  return r.data;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
}

export function intParam(v: string | undefined, def: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

/** CSV with formula-injection protection (cells starting with = + - @ are prefixed). */
export function toCsv(columns: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}
