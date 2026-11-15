import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, CHART, ChartCard, StockBadge } from "@/components/domain";
import { Button, Card, CardHeader, ConfirmDialog, DataTable, ErrorState, MetricCard, PageHeader, PageSkeleton, Select, StatusBadge, Field, Input } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtDateTime, money, num, pct } from "@/lib/utils";

export default function MerchantDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<any>(`/api/merchants/${id}`);
  const toast = useToast();
  const [cap, setCap] = useState<string | null>(null);
  const [toggle, setToggle] = useState(false);
  if (loading) return <PageSkeleton cards={3} />;
  if (error || !data) return <ErrorState error={error ?? "Not found"} onRetry={reload} />;
  const m = data.merchant;
  const patch = async (body: object, msg: string) => { await api.patch(`/api/merchants/${m.id}`, body); toast.success(msg); reload(); };
  return (
    <div>
      <Link to="/app/merchants" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Merchants</Link>
      <PageHeader title={m.name} subtitle={<>{m.id} · {m.category} · {m.communityName} <StatusBadge status={m.status} />{!m.participating && <> <StatusBadge status="inactive" label="Not participating" /></>}</>}
        actions={<><label className="flex items-center gap-2 text-sm"><span className="text-muted">Status</span><Select aria-label="Operating status" className="h-9 w-32" value={m.status} onChange={(e) => patch({ status: e.target.value }, `Status set to ${e.target.value}`).catch((x) => toast.error(x.message))}><option value="open">Open</option><option value="limited">Limited</option><option value="closed">Closed</option></Select></label>
          <Button variant="outline" onClick={() => setToggle(true)}>{m.participating ? "Deactivate" : "Reactivate"}</Button></>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Capacity score" value={`${m.capacityScore}/100`} sub={`Effective now: ${m.effectiveCapacity}`} /><MetricCard label="Inventory sufficiency" value={pct(m.inventorySufficiency)} sub="Items above their minimum" />
        <MetricCard label="Completed redemptions" value={num(m.redemptionCount)} /><MetricCard label="Outstanding claims" value={money(m.outstandingCents)} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card><CardHeader title="Inventory" /><DataTable rows={data.inventory} rowKey={(i: any) => i.id} caption="Inventory" columns={[{ key: "n", header: "Item", render: (i: any) => i.name }, { key: "q", header: "Stock", align: "right", render: (i: any) => `${num(i.quantity)} ${i.unit}` }, { key: "p", header: "Price", align: "right", hideOnMobile: true, render: (i: any) => money(i.unitPriceCents) }, { key: "s", header: "Level", render: (i: any) => <StockBadge s={i.status} /> }]} /></Card>
        <ChartCard title="Sales performance" subtitle="Redeemed value per day" height={260}>
          <BarChart data={data.performance.map((p: any) => ({ day: p.day.slice(5), value: p.valueCents / 100 }))} margin={{ left: -8, right: 8, top: 8 }}><CartesianGrid stroke={CHART.grid} vertical={false} /><XAxis dataKey="day" {...axisProps} minTickGap={20} /><YAxis {...axisProps} tickFormatter={(v) => `$${v}`} width={48} /><Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} contentStyle={{ borderRadius: 10, border: `1px solid ${CHART.grid}` }} /><Bar dataKey="value" name="Redeemed" fill={CHART.teal} radius={[3, 3, 0, 0]} /></BarChart>
        </ChartCard>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card><CardHeader title="Recent transactions" /><DataTable rows={data.transactions.slice(0, 10)} rowKey={(t: any) => t.id} caption="Transactions" empty={<p className="p-5 text-sm text-muted">No transactions.</p>} columns={[{ key: "r", header: "Receipt", render: (t: any) => <span>{t.receiptNo}<span className="block text-xs font-normal text-muted">{fmtDateTime(t.createdAt)}</span></span> }, { key: "a", header: "Amount", align: "right", render: (t: any) => money(t.amountCents) }, { key: "s", header: "Status", render: (t: any) => <StatusBadge status={t.status} /> }]} /></Card>
        <Card><CardHeader title="Reimbursement claims" /><DataTable rows={data.claims} rowKey={(c: any) => c.id} caption="Claims" empty={<p className="p-5 text-sm text-muted">No claims.</p>} columns={[{ key: "i", header: "Claim", render: (c: any) => c.id }, { key: "a", header: "Amount", align: "right", render: (c: any) => money(c.amountCents) }, { key: "n", header: "Items", align: "right", hideOnMobile: true, render: (c: any) => c.itemCount }, { key: "s", header: "Status", render: (c: any) => <StatusBadge status={c.status} /> }]} /></Card>
      </div>
      <Card className="mt-6"><CardHeader title="Capacity score" subtitle="Used by the allocation engine, scaled by operating status." />
        <form className="flex flex-wrap items-end gap-3 p-5" onSubmit={(e) => { e.preventDefault(); const v = Number(cap ?? m.capacityScore); if (!Number.isInteger(v) || v < 0 || v > 100) { toast.error("Capacity must be a whole number from 0 to 100"); return; } patch({ capacityScore: v }, "Capacity updated").catch((x) => toast.error(x.message)); }}>
          <Field label="Capacity (0–100)" htmlFor="cap"><Input id="cap" type="number" className="w-32" value={cap ?? m.capacityScore} onChange={(e) => setCap(e.target.value)} /></Field><Button type="submit" variant="outline">Update</Button>
        </form></Card>
      <ConfirmDialog open={toggle} onOpenChange={setToggle} danger={m.participating} title={m.participating ? "Deactivate this merchant?" : "Reactivate this merchant?"} description={m.participating ? "It will no longer count towards market capacity and cannot redeem vouchers." : "It will count towards market capacity again."} confirmLabel={m.participating ? "Deactivate" : "Reactivate"} onConfirm={() => patch({ participating: !m.participating }, m.participating ? "Merchant deactivated" : "Merchant reactivated")} />
    </div>
  );
}
