import { Check, Copy, Maximize2 } from "lucide-react";
import { useState } from "react";
import { VoucherQR, CategoryChips } from "@/components/domain";
import { Button, Card, EmptyState, ErrorState, Modal, PageSkeleton, StatusBadge, ProgressBar } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtDate, money } from "@/lib/utils";

export default function ResidentVouchers() {
  const { data, error, loading, reload } = useApi<any>("/api/resident/vouchers");
  const [big, setBig] = useState<any>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const toast = useToast();
  if (loading) return <PageSkeleton cards={1} />;
  if (error || !data) return <ErrorState error={error ?? "No data"} onRetry={reload} />;
  const copy = async (code: string) => { try { await navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(null), 1500); } catch { toast.error("Could not copy. Select the code and copy it manually."); } };
  return (
    <div className="space-y-5">
      <div><h1 className="font-display text-[32px] leading-tight text-evergreen">My vouchers</h1><p className="text-sm text-muted">Show the QR code at checkout, or read out the voucher code.</p></div>
      {!data.items.length && <Card><EmptyState title="No vouchers yet" message="When assistance is issued to you, your voucher appears here." /></Card>}
      {data.items.map((v: any) => (
        <Card key={v.id} className={v.status === "active" ? "overflow-hidden" : "overflow-hidden opacity-80"}>
          <div className="flex items-center justify-between border-b border-line px-5 py-3"><span className="font-mono text-sm font-semibold text-evergreen">{v.code}</span><StatusBadge status={v.status} /></div>
          <div className="p-5 text-center">
            {v.token ? (<>
              <button onClick={() => setBig(v)} className="group relative inline-block" aria-label={`Enlarge QR code for voucher ${v.code}`}><VoucherQR token={v.token} size={190} /><span className="absolute right-2 top-2 rounded bg-warm p-1 text-muted border border-border group-hover:text-ink"><Maximize2 className="size-3.5" /></span></button>
              <div className="mt-3 flex items-center justify-center gap-2"><code className="max-w-full truncate rounded bg-canvas px-2 py-1 text-xs text-ink" data-testid="voucher-token">{v.token}</code><Button size="sm" variant="outline" onClick={() => copy(v.token)} aria-label="Copy voucher code">{copied === v.token ? <Check className="size-4" /> : <Copy className="size-4" />}</Button></div>
            </>) : <p className="py-6 text-sm text-muted">{v.status === "exhausted" ? "This voucher has been fully used." : v.status === "expired" ? "This voucher has expired." : "This voucher is no longer valid."}</p>}
          </div>
          <div className="space-y-3 border-t border-line bg-canvas/50 px-5 py-4 text-sm">
            <div><div className="mb-1 flex justify-between"><span className="text-muted">Remaining</span><span className="tabular font-semibold text-ink">{money(v.remainingCents)} <span className="font-normal text-muted">of {money(v.amountCents)}</span></span></div><ProgressBar value={v.amountCents ? v.remainingCents / v.amountCents : 0} /></div>
            <div className="flex justify-between"><span className="text-muted">Expires</span><span className="font-medium">{fmtDate(v.expiresAt)}</span></div>
            <div><p className="mb-1 text-muted">Can be used for</p><CategoryChips cats={v.eligibleCategories} /></div>
          </div>
        </Card>
      ))}
      <Modal open={!!big} onOpenChange={(o) => !o && setBig(null)} title="Scan this code" description={big ? `Voucher ${big.code} · ${money(big.remainingCents)} remaining` : undefined}>{big?.token && <div className="flex justify-center"><VoucherQR token={big.token} size={280} /></div>}</Modal>
    </div>
  );
}
