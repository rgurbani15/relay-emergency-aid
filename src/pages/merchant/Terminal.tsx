import jsQR from "jsqr";
import { AlertCircle, Camera, CameraOff, CheckCircle2, Minus, Plus, RotateCcw, ScanLine, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { categoryLabel } from "@shared/constants";
import { CategoryChips, ReceiptView, StockBadge } from "@/components/domain";
import { Button, Card, CardHeader, ErrorState, Field, FilterSelect, Input, SearchInput, Notice, PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, useApi, useDebounced } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { cn, fmtDate, money, uid } from "@/lib/utils";

interface Validation { ok: boolean; voucherValid: boolean; issues: { code: string; message: string; itemId?: string }[]; voucher: null | { code: string; remainingCents: number; amountCents: number; expiresAt: string; eligibleCategories: string[]; residentLabel: string }; basket: { lines: any[]; totalCents: number }; balanceAfterCents: number | null }

export default function Terminal() {
  const products = useApi<{ items: any[] }>("/api/merchant/products");
  const toast = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [scanning, setScanning] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [val, setVal] = useState<Validation | null>(null);
  const [checking, setChecking] = useState(false);
  const [netErr, setNetErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [redeemErr, setRedeemErr] = useState<string | null>(null);
  const key = useRef<string>(uid());

  const items = Object.entries(qty).filter(([, n]) => n > 0).map(([inventoryItemId, quantity]) => ({ inventoryItemId, quantity }));
  const basketSig = JSON.stringify(items);
  const dSig = useDebounced(basketSig, 250);

  // Validate whenever the voucher or basket changes. A new basket gets a new idempotency key.
  useEffect(() => {
    if (!token) { setVal(null); return; }
    let stale = false;
    setChecking(true); setNetErr(null);
    api.post("/api/merchant/terminal/validate", { token, items: JSON.parse(dSig) }).then((v) => { if (!stale) setVal(v); }).catch((e) => { if (!stale) setNetErr(e.message); }).finally(() => !stale && setChecking(false));
    return () => { stale = true; };
  }, [token, dSig]);
  useEffect(() => { key.current = uid(); setRedeemErr(null); }, [token, basketSig]);

  const accept = useCallback((t: string) => { const v = t.trim(); if (v.length < 6) return; setToken(v); setScanning(false); setQty({}); setReceipt(null); }, []);
  const reset = () => { setToken(null); setManual(""); setQty({}); setVal(null); setReceipt(null); setRedeemErr(null); key.current = uid(); products.reload(); };
  const setItem = (id: string, n: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(999, n)) }));

  const redeem = async () => {
    if (!token || busy) return;
    setBusy(true); setRedeemErr(null);
    try {
      const r = await api.post("/api/merchant/terminal/redeem", { token, items, idempotencyKey: key.current });
      setReceipt(r.receipt); toast.success(r.receipt.duplicate ? "Duplicate request recognised. Showing the original receipt." : `Sale complete: ${money(r.receipt.amountCents)}`);
    } catch (e) {
      // Network failures keep the same idempotency key, so a retry can never double-charge.
      setRedeemErr(e instanceof ApiError && e.status > 0 ? e.message : "Connection problem. It is safe to try again — you will not be charged twice.");
      if (e instanceof ApiError && e.status === 409) setBasketRefresh();
    } finally { setBusy(false); }
  };
  const setBasketRefresh = () => { products.reload(); setQty((q) => ({ ...q })); };

  const [pq, setPq] = useState(""), [pcat, setPcat] = useState("all");
  const issuesFor = (id: string) => val?.issues.filter((i) => i.itemId === id) ?? [];
  const globalIssues = val?.issues.filter((i) => !i.itemId && i.code !== "empty_basket") ?? [];
  const canRedeem = !!val?.ok && items.length > 0 && !checking && !busy && dSig === basketSig;

  if (receipt) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className="text-center" role="status"><CheckCircle2 className="mx-auto size-12 text-success" aria-hidden /><h1 className="font-display mt-2 text-[32px] text-evergreen">Sale complete</h1></div>
        <ReceiptView r={receipt} printable />
        <Button size="lg" className="w-full" onClick={reset}><RotateCcw className="size-4" />New sale</Button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="POS terminal" subtitle="Scan the resident’s QR code or type the voucher code, then build the basket." actions={token && <Button variant="outline" onClick={reset}><X className="size-4" />Cancel sale</Button>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="1 · Voucher" />
            <div className="space-y-4 p-5">
              {!token ? (<>
                <form onSubmit={(e) => { e.preventDefault(); accept(manual); }} className="flex items-end gap-2">
                  <div className="flex-1"><Field label="Voucher code" htmlFor="vc" hint="Example: VCH-0001-ABCD1234"><Input id="vc" value={manual} onChange={(e) => setManual(e.target.value.toUpperCase())} placeholder="VCH-…" autoComplete="off" autoCapitalize="characters" spellCheck={false} className="font-mono" /></Field></div>
                  <Button type="submit" size="lg" disabled={manual.trim().length < 6}>Validate</Button>
                </form>
                <div className="flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
                {scanning ? <Scanner onCode={accept} onClose={() => setScanning(false)} /> : <Button variant="outline" size="lg" className="w-full" onClick={() => setScanning(true)}><Camera className="size-5" />Scan QR code with camera</Button>}
              </>) : (<>
                <div className="flex items-center justify-between"><code className="rounded bg-canvas px-2 py-1 text-xs">{token}</code><Button size="sm" variant="ghost" onClick={reset}>Change</Button></div>
                {checking && !val && <Skeleton className="h-24" />}
                {netErr && <Notice tone="danger">{netErr}</Notice>}
                {val?.voucher && (
                  <div className="space-y-3 rounded-xl border border-line p-4">
                    <div className="flex items-center justify-between"><div><p className="text-xs text-muted">Resident</p><p className="font-semibold text-navy">{val.voucher.residentLabel}</p></div><div className="text-right"><p className="text-xs text-muted">Balance</p><p className="tabular text-2xl font-semibold text-navy">{money(val.voucher.remainingCents)}</p></div></div>
                    <p className="text-xs text-muted">Expires {fmtDate(val.voucher.expiresAt)}</p><CategoryChips cats={val.voucher.eligibleCategories} />
                  </div>
                )}
                {globalIssues.map((i) => <Notice key={i.code} tone="danger"><span className="flex items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" />{i.message}</span></Notice>)}
                {val && !val.voucherValid && !val.voucher && !globalIssues.length && <Notice tone="danger">This voucher could not be validated.</Notice>}
              </>)}
            </div>
          </Card>
        </div>

        <Card className={cn(!val?.voucherValid && "opacity-60")}>
          <CardHeader title="2 · Basket" subtitle={val?.voucherValid ? "Tap + to add items. Only eligible, in-stock items can be sold." : "Validate a voucher first."} />
          {!!products.data?.items.length && <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3"><SearchInput value={pq} onChange={setPq} placeholder="Search products" className="w-full sm:w-52" /><FilterSelect label="Category" value={pcat} onChange={setPcat} options={[{ value: "all", label: "All categories" }, ...Array.from(new Set(products.data.items.map((p) => p.category))).map((c) => ({ value: c, label: categoryLabel(c) }))]} /></div>}
          {products.error ? <div className="p-5"><ErrorState error={products.error} onRetry={products.reload} /></div> : (
            <ul className="divide-y divide-line">
              {products.loading && <li className="space-y-2 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></li>}
              {(products.data?.items ?? []).filter((p) => (pcat === "all" || p.category === pcat) && p.name.toLowerCase().includes(pq.trim().toLowerCase())).map((p) => {
                const n = qty[p.id] ?? 0; const bad = issuesFor(p.id)[0]; const eligible = !val?.voucher || val.voucher.eligibleCategories.includes(p.category);
                const disabled = !val?.voucherValid || p.quantity <= 0 || !eligible;
                return (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{p.name}</p><p className="text-xs text-muted">{categoryLabel(p.category)} · {money(p.unitPriceCents)} / {p.unit} · <span className="tabular">{p.quantity}</span> in stock {p.quantity <= 0 && <StockBadge s="out_of_stock" />}</p>{!eligible && val?.voucher && <p className="text-xs text-warning">Not covered by this voucher</p>}{bad && <p className="text-xs font-medium text-danger" role="alert">{bad.message}</p>}</div>
                    <div className="flex items-center gap-1.5"><Button size="sm" variant="outline" aria-label={`Remove one ${p.name}`} disabled={disabled || n === 0} onClick={() => setItem(p.id, n - 1)}><Minus className="size-4" /></Button><span className="tabular w-8 text-center text-sm font-semibold" aria-live="polite">{n}</span><Button size="sm" variant="outline" aria-label={`Add one ${p.name}`} disabled={disabled || n >= p.quantity} onClick={() => setItem(p.id, n + 1)}><Plus className="size-4" /></Button></div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="space-y-3 border-t border-line bg-canvas/50 px-5 py-4">
            <div className="flex items-center justify-between"><span className="text-sm text-muted">Total</span><span className="tabular text-2xl font-semibold text-navy">{money(val?.basket.totalCents ?? 0)}</span></div>
            {val?.balanceAfterCents != null && items.length > 0 && <div className="flex items-center justify-between text-sm"><span className="text-muted">Voucher balance after sale</span><span className="tabular font-medium">{money(val.balanceAfterCents)}</span></div>}
            {val && items.length > 0 && val.issues.filter((i) => !i.itemId).length > 0 && !globalIssues.length && null}
            {redeemErr && <Notice tone="danger">{redeemErr}</Notice>}
            <Button size="lg" className="w-full" disabled={!canRedeem} loading={busy} onClick={redeem}><ScanLine className="size-5" />Complete sale</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Camera QR scanner. Falls back gracefully when the camera is missing or permission is denied. */
function Scanner({ onCode, onClose }: { onCode: (t: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null, raf = 0, done = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setErr("Camera scanning is not available in this browser. Type the voucher code instead."); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = video.current; if (!v) return; v.srcObject = stream; await v.play();
        const tick = () => {
          if (done) return;
          if (v.readyState === v.HAVE_ENOUGH_DATA && ctx && v.videoWidth) {
            canvas.width = v.videoWidth; canvas.height = v.videoHeight; ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (code?.data) { done = true; onCode(code.data); return; }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        setErr((e as DOMException)?.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access, or type the voucher code instead." : "No camera could be started. Type the voucher code instead.");
      }
    })();
    return () => { done = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);
  return (
    <div className="space-y-3">
      {err ? <Notice tone="warning"><span className="flex items-start gap-2"><CameraOff className="mt-0.5 size-4 shrink-0" />{err}</span></Notice> : (
        <div className="relative overflow-hidden rounded-xl bg-evergreen"><video ref={video} className="aspect-[4/3] w-full object-cover" playsInline muted aria-label="Camera preview" /><div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-evergreen/80" aria-hidden /></div>
      )}
      <Button variant="outline" className="w-full" onClick={onClose}>Stop scanning</Button>
    </div>
  );
}
