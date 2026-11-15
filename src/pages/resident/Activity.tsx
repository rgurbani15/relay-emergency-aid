import { useState } from "react";
import { Card, EmptyState, ErrorState, Pagination, PageSkeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDateTime, money, titleCase } from "@/lib/utils";

export default function ResidentActivity() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<any>(`/api/resident/activity?page=${page}&pageSize=12`);
  if (loading) return <PageSkeleton cards={1} />;
  if (error || !data) return <ErrorState error={error ?? "No data"} onRetry={reload} />;
  const label = (a: any) => a.type === "assistance_issued" ? "Assistance received" : a.type === "voucher_redeemed" ? `Purchase at ${a.merchantName ?? "store"}` : a.type === "voucher_reversal" ? `Refund from ${a.merchantName ?? "store"}` : titleCase(a.type);
  return (
    <div className="space-y-4">
      <div><h1 className="font-display text-[32px] leading-tight text-evergreen">Activity</h1><p className="text-sm text-muted">Everything that changed your balance.</p></div>
      <Card>
        <ul className="divide-y divide-line">{data.items.map((a: any) => <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><div className="min-w-0"><p className="truncate font-medium text-ink">{label(a)}</p><p className="truncate text-xs text-muted">{fmtDateTime(a.createdAt)}{a.receiptNo ? ` · ${a.receiptNo}` : ""}{a.voucherCode ? ` · ${a.voucherCode}` : ""}</p></div><span className={`tabular font-semibold ${a.amountCents < 0 ? "text-ink" : "text-success"}`}>{a.amountCents > 0 ? "+" : ""}{money(a.amountCents)}</span></li>)}{!data.items.length && <li><EmptyState title="No activity yet" /></li>}</ul>
        <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
      </Card>
    </div>
  );
}
