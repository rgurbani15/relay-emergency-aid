import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { api } from "../lib/api";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS: Record<string, string[]> = {
  coordinator: ["Which community is struggling most and why?", "Explain the recommended voucher vs direct supply mix.", "What shortages should I worry about in the next 72 hours?", "How is market viability calculated?"],
  merchant: ["What is my reimbursement status?", "Which of my items are low on stock?", "How much did I accept in the last 24 hours?", "Have I been paid for approved claims?"],
  resident: ["What is my balance?", "When do my vouchers expire?", "Where can I use my voucher?", "What can I buy with it?"],
};

export function ChatPanel({ role, programId, className = "" }: { role: "coordinator" | "merchant" | "resident"; programId?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, busy, open]);

  async function send(q: string) {
    const message = q.trim();
    if (!message || busy) return;
    setErr(null); setText("");
    const history = msgs.slice(-6);
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setBusy(true);
    try {
      const r = await api.post<{ reply: string }>("/api/chat", { message, history, programId });
      setMsgs((m) => [...m, { role: "assistant", content: r.reply }]);
    } catch (e) {
      setErr((e as Error).message || "Something went wrong. Try again.");
    } finally { setBusy(false); }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Ask RELAY"
        className={`fixed bottom-5 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-evergreen px-4 py-3 text-sm font-semibold text-white shadow-lg hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${open ? "hidden" : ""} ${className}`}>
        <MessageCircle size={18} aria-hidden /> Ask RELAY
      </button>
      {open && (
        <section role="dialog" aria-label="Ask RELAY" className="fixed inset-x-2 bottom-2 z-50 flex max-h-[80vh] flex-col rounded-xl border border-black/10 bg-white shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[400px]">
          <header className="flex items-center justify-between border-b border-black/10 px-4 py-3">
            <div><h2 className="text-sm font-semibold">Ask RELAY</h2><p className="text-xs text-black/60">Explains your data. It can't change anything.</p></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="rounded p-1 hover:bg-black/5"><X size={18} /></button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
            {msgs.length === 0 && (
              <div className="space-y-2">
                <p className="text-black/70">Ask about your numbers, balances, stock or recommendations. Try:</p>
                {SUGGESTIONS[role].map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="block w-full rounded-lg border border-black/10 px-3 py-2 text-left hover:bg-black/5">{s}</button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "ml-8 rounded-lg bg-evergreen px-3 py-2 text-white" : "mr-8 whitespace-pre-wrap rounded-lg bg-black/5 px-3 py-2"}>{m.content}</div>
            ))}
            {busy && <div className="mr-8 rounded-lg bg-black/5 px-3 py-2 text-black/60">Thinking…</div>}
            {err && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">{err}</div>}
            <div ref={end} />
          </div>
          <form className="flex gap-2 border-t border-black/10 p-3" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={800} placeholder="Ask a question…" aria-label="Your question" className="min-w-0 flex-1 rounded-lg border border-black/20 px-3 py-2 text-sm" />
            <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="rounded-lg bg-evergreen px-3 text-white disabled:opacity-40"><Send size={16} /></button>
          </form>
          <p className="px-4 pb-3 text-[11px] text-black/50">AI can make mistakes. Check important figures in the app. Chats are not saved.</p>
        </section>
      )}
    </>
  );
}
