import { useCallback, useEffect, useState } from "react";
import { qs, useApi, useDebounced } from "./api";

/** Shared list state: search (debounced), filters, sort and paging, all mapped onto query-string params. */
export function useList<T = any>(base: string, initial: Record<string, string | number> = {}, extra: Record<string, string | number | null | undefined> = {}, pageSize?: number) {
  const [params, setParams] = useState<Record<string, string | number>>({ page: 1, ...initial });
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const set = useCallback((patch: Record<string, string | number>) => setParams((p) => ({ ...p, ...patch, page: "page" in patch ? patch.page : 1 })), []);
  const extraKey = JSON.stringify(extra);
  useEffect(() => { setParams((p) => ({ ...p, page: 1 })); }, [dq, extraKey]);
  const url = base + qs({ ...params, ...extra, q: dq, pageSize });
  const api = useApi<{ items: T[]; total: number; page: number; pageSize: number } & Record<string, any>>(url);
  const sort = params.sort ? { key: String(params.sort), dir: (params.dir as "asc" | "desc") ?? "asc" } : undefined;
  const onSort = (key: string) => setParams((p) => ({ ...p, sort: key, dir: p.sort === key && p.dir === "asc" ? "desc" : "asc", page: 1 }));
  return { ...api, params, set, q, setQ, sort, onSort, page: Number(params.page) || 1, setPage: (n: number) => set({ page: n }) };
}
