import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: any) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method, credentials: "same-origin",
    headers: { ...(method !== "GET" ? { "content-type": "application/json", "x-relay-client": "web" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "error", json?.error?.message ?? `Request failed (${res.status})`, json?.error?.details);
  return json as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>("GET", p),
  post: <T = any>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  patch: <T = any>(p: string, b?: unknown) => request<T>("PATCH", p, b ?? {}),
};

export const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== "all") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** Fetch hook with stale-while-revalidate: `loading` is true only for the first load; `refreshing` for later ones. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!path) { setData(null); setLoading(false); return; }
    const id = ++seq.current;
    const samePath = lastPath.current === path;
    lastPath.current = path;
    if (!samePath) setLoading((d) => d || true);
    setRefreshing(true);
    api.get<T>(path).then(
      (d) => { if (id === seq.current) { setData(d); setError(null); setLoading(false); setRefreshing(false); } },
      (e) => { if (id === seq.current) { setError(e instanceof ApiError ? e : new ApiError(0, "network", "Network error. Check your connection.")); setLoading(false); setRefreshing(false); } },
    );
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading: loading && !data, refreshing, reload, setData };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
