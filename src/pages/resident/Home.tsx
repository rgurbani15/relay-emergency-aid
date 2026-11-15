import { Clock, QrCode, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, Notice, PageSkeleton, Badge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate, money, timeAgo, titleCase } from "@/lib/utils";

export default function ResidentHome() {
  const { data, error, loading, reload } = useApi<any>("/api/resident/summary");
  if (loading) return <PageSkeleton cards={2} />;
  if (error || !data) return <ErrorState error={error ?? "No data"} onRetry={reload} />;
  const daysLeft = data.nextExpiry ? Math.ceil((new Date(data.nextExpiry).getTime() - Date.now()) / 86_400_000) : null;
  return (
    <div className="space-y-5">
      <div><p className="eyebrow">{data.resident.name}</p><h1 className="font-display mt-1 text-[34px] leading-tight text-evergreen">Your assistance</h1><p className="mt-1 text-sm text-secondary">{data.resident.communityName} · {data.program.name}</p></div>
      {data.resident.status === "suspended" && <Notice tone="warning">Your assistance is currently suspended. Please contact your relief coordinator.</Notice>}
      <div className="overflow-hidden rounded-xl bg-evergreen p-6 text-warm">
        <p className="flex items-center gap-2 text-sm text-sidebar-muted"><Wallet className="size-4" />Available balance</p>
        <p className="font-display tabular mt-2 text-[44px] leading-none" aria-label={`Balance ${money(data.balanceCents)}`}>{money(data.balanceCents)}</p>
        <div className="mt-5 flex items-center justify-between text-sm text-sidebar-muted"><span>{data.activeVouchers} active voucher{data.activeVouchers === 1 ? "" : "s"}</span>{data.nextExpiry && <span className="flex items-center gap-1"><Clock className="size-3.5" />{daysLeft !== null && daysLeft <= 7 ? <strong className="text-warning">Expires in {Math.max(daysLeft, 0)}d</strong> : `Next expiry ${fmtDate(data.nextExpiry)}`}</span>}</div>
        <Link to="/resident/vouchers"><Button size="lg" variant="outline" className="mt-5 w-full border-warm !text-evergreen"><QrCode className="size-5" />Show my voucher</Button></Link>
      </div>
      <div className="grid grid-cols-2 gap-3"><Card className="p-4"><p className="text-xs text-muted">Total received</p><p className="tabular text-xl font-semibold text-navy">{money(data.issuedCents)}</p></Card><Card className="p-4"><p className="text-xs text-muted">Spent so far</p><p className="tabular text-xl font-semibold text-navy">{money(data.redeemedCents)}</p></Card></div>
      <section aria-labelledby="ra"><div className="mb-2 flex items-center justify-between"><h2 id="ra" className="font-display text-[22px] text-evergreen">Recent activity</h2><Link to="/resident/activity" className="text-sm font-medium text-forest">See all</Link></div>
        <Card><ul className="divide-y divide-line">{data.recent.map((a: any) => <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><div><p className="font-medium text-ink">{a.type === "assistance_issued" ? "Assistance received" : a.type === "voucher_redeemed" ? "Purchase" : titleCase(a.type)}</p><p className="text-xs text-muted">{timeAgo(a.createdAt)}</p></div><span className={`tabular font-semibold ${a.amountCents < 0 ? "text-ink" : "text-success"}`}>{a.amountCents > 0 ? "+" : ""}{money(a.amountCents)}</span></li>)}{!data.recent.length && <li><EmptyState title="No activity yet" message="Assistance and purchases will appear here." /></li>}</ul></Card></section>
      <p className="text-center text-xs text-muted"><Badge tone="neutral">Demo</Badge> Synthetic data. No real money.</p>
    </div>
  );
}
