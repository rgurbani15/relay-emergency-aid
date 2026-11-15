import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatCents } from "@shared/money";

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));
export const money = (cents: number | null | undefined, compact = false) => formatCents(cents ?? 0, { compact });
export const pct = (v: number | null | undefined, digits = 0) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);
export const num = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));

const dtf = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const dtt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const fmtDate = (iso: string | null | undefined) => (iso ? dtf.format(new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso)) : "—");
export const fmtDateTime = (iso: string | null | undefined) => (iso ? dtt.format(new Date(iso)) : "—");
export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "—";
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export const titleCase = (s: string) => s.replace(/[_.]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
export const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function downloadFile(name: string, content: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function safeStorage() {
  return {
    get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
}
