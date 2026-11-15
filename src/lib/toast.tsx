import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "./utils";

type Tone = "success" | "error" | "info";
interface T { id: number; tone: Tone; message: string }
interface Ctx { success: (m: string) => void; error: (m: string) => void; info: (m: string) => void }
const ToastCtx = createContext<Ctx>(null as never);
let n = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((tone: Tone, message: string) => {
    const id = ++n;
    setItems((x) => [...x.slice(-3), { id, tone, message }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);
  const value = useMemo(() => ({ success: (m: string) => push("success", m), error: (m: string) => push("error", m), info: (m: string) => push("info", m) }), [push]);
  const icon = { success: <CheckCircle2 className="size-4 text-success" />, error: <AlertCircle className="size-4 text-danger" />, info: <Info className="size-4 text-info" /> };
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" role="region" aria-label="Notifications" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cn("pop-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border bg-warm p-3 text-sm shadow-pop", t.tone === "error" ? "border-danger/40" : "border-line")} role={t.tone === "error" ? "alert" : "status"}>
            <span className="mt-0.5">{icon[t.tone]}</span>
            <span className="flex-1 text-ink">{t.message}</span>
            <button className="text-muted hover:text-ink" aria-label="Dismiss" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}><X className="size-4" /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
