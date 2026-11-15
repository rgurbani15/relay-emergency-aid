import { ArrowRight, Boxes, Clock, ShoppingBag } from "lucide-react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, CHART, ChartCard } from "@/components/domain";
import { Badge, Button, Card, CardHeader, ErrorState, MetricCard, Notice, PageHeader, PageSkeleton, StatusBadge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { money, timeAgo } from "@/lib/utils";

export default function MerchantDashboard() {
  const me = useApi<any>("/api/merchant/me");
  const { data, error, loading, reload } = useApi<any>("/api/merchant/dashboard");
  if (loading || me.loading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error ?? "No data"} onRetry={reload} />;
  const m = me.data?.merchant;
  const low = data.stock.low + data.stock.critical + data.stock.out_of_stock;
  return (
    <div>
      <PageHeader eyebrow="Merchant dashboard" title={m?.name ?? "Merchant"} subtitle={m && <>{m.communityName} · {m.programName ?? "No active program"} <StatusBadge status={m.status} /></>} actions={<Link to="/merchant/terminal"><Button size="lg"><ShoppingBag className="size-5" />Open POS terminal</Button></Link>} />
      {m && !m.participating && <Notice tone="warning" className="mb-4">Your business is not currently participating, so vouchers cannot be redeemed here.</Notice>}
      {m?.status === "closed" && <Notice tone="warning" className="mb-4">Your business is marked closed. Contact the relief coordinator to reopen.</Notice>}
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Sales, last 24h" value={money(data.last24h.cents)} sub={`${data.last24h.count} voucher redemptions`} icon={<ShoppingBag className="size-4" />} />
        <MetricCard label="Awaiting reimbursement" value={money(data.outstanding.cents)} sub={`${data.outstanding.claims} open claim${data.outstanding.claims === 1 ? "" : "s"}`} icon={<Clock className="size-4" />} tone="warning" />
        <MetricCard label="Items needing restock" value={String(low)} sub={`${data.stock.healthy} healthy`} icon={<Boxes className="size-4" />} tone={low ? "danger" : "success"} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <ChartCard title="Daily sales" subtitle="Last 14 days" height={260}><BarChart data={data.daily.map((d: any) => ({ day: d.day.slice(5), value: d.cents / 100 }))} margin={{ left: -8, right: 8, top: 8 }}><CartesianGrid stroke={CHART.grid} vertical={false} /><XAxis dataKey="day" {...axisProps} /><YAxis {...axisProps} tickFormatter={(v) => `$${v}`} width={48} /><Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} contentStyle={{ borderRadius: 10, border: `1px solid ${CHART.grid}` }} /><Bar dataKey="value" name="Sales" fill={CHART.teal} radius={[3, 3, 0, 0]} /></BarChart></ChartCard>
        <Card><CardHeader title="Recent sales" action={<Link to="/merchant/sales" className="text-sm font-medium text-teal-dark hover:underline">All sales</Link>} />
          <ul className="divide-y divide-line">{data.recent.map((r: any) => <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><div><p className="font-medium text-ink">{r.receiptNo}</p><p className="text-xs text-muted">{r.voucherCode} · {timeAgo(r.createdAt)}</p></div><div className="text-right"><p className="tabular font-semibold">{money(r.amountCents)}</p>{r.status !== "completed" && <Badge tone="danger">Reversed</Badge>}</div></li>)}{!data.recent.length && <li className="p-6 text-center text-sm text-muted">No sales yet.</li>}</ul></Card>
      </div>
      {low > 0 && <Card className="mt-6 flex items-center justify-between gap-3 p-4"><p className="text-sm text-ink"><strong>{low}</strong> item{low === 1 ? "" : "s"} running low. Update stock so the allocation engine sees accurate supply.</p><Link to="/merchant/inventory"><Button variant="outline" size="sm">Update inventory <ArrowRight className="size-4" /></Button></Link></Card>}
    </div>
  );
}
