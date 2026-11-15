import { Download } from "lucide-react";
import { useState } from "react";
import { Button, Card, CardHeader, DataTable, Drawer, ErrorState, MetricCard, Notice, PageHeader, PageSkeleton, StatusBadge } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { downloadFile, fmtDate, fmtDateTime, money } from "@/lib/utils";

export default function Reimbursements() {
  const { data, error, loading, reload } = useApi<any>("/api/merchant/reimbursements");
  const [sel, setSel] = useState<any>(null);
  const toast = useToast();
  if (loading) return <PageSkeleton cards={3} />;
  if (error || !data) return <ErrorState error={error ?? "No data"} onRetry={reload} />;
  const t = data.totals;
  const g = (k: string) => t[k] ?? { count: 0, cents: 0 };
  const csv = async () => { const r = await fetch("/api/merchant/reimbursements?format=csv", { credentials: "same-origin" }); if (!r.ok) return toast.error("Export failed"); downloadFile("relay-reimbursement-statement.csv", await r.text()); };
  return (
    <div>
      <PageHeader title="Reimbursements" subtitle="Claims are created automatically with each redemption." actions={<Button variant="outline" onClick={csv}><Download className="size-4" />Statement CSV</Button>} />
      <Notice tone="info" className="mb-4">A claim marked approved means the coordinator has validated it. In this demonstration no payment is made.</Notice>
      <div className="grid gap-4 sm:grid-cols-3"><MetricCard label="Pending review" value={money(g("pending").cents)} sub={`${g("pending").count} claims`} tone="warning" /><MetricCard label="Approved" value={money(g("approved").cents)} sub={`${g("approved").count} claims`} tone="success" /><MetricCard label="Rejected" value={money(g("rejected").cents)} sub={`${g("rejected").count} claims`} tone="danger" /></div>
      <Card className="mt-6"><CardHeader title="Claims" />
        <DataTable rows={data.items} rowKey={(r: any) => r.id} caption="Claims" empty={<p className="p-6 text-center text-sm text-muted">No claims yet.</p>} onRowClick={(r: any) => api.get(`/api/merchant/reimbursements/${r.id}`).then(setSel).catch((e) => toast.error(e.message))} columns={[
          { key: "i", header: "Claim", render: (r: any) => <span>{r.id}<span className="block text-xs font-normal text-muted">{fmtDate(r.createdAt)}</span></span> },
          { key: "n", header: "Redemptions", align: "right", hideOnMobile: true, render: (r: any) => r.itemCount },
          { key: "a", header: "Amount", align: "right", render: (r: any) => money(r.amountCents) },
          { key: "s", header: "Status", render: (r: any) => <StatusBadge status={r.status} /> },
        ]} /></Card>
      <Drawer open={!!sel} onOpenChange={(o) => !o && setSel(null)} title={sel ? `Claim ${sel.claim.id}` : ""} subtitle={sel && `${money(sel.claim.amountCents)} · ${sel.claim.status}`}>
        {sel && <div className="space-y-3">{sel.claim.rejectionReason && <Notice tone="warning">Rejected: {sel.claim.rejectionReason}</Notice>}<ul className="divide-y divide-line rounded-lg border border-line text-sm">{sel.items.map((i: any) => <li key={i.redemptionId} className="flex justify-between px-3 py-2"><span>{i.receiptNo}<span className="block text-xs text-muted">{fmtDateTime(i.createdAt)}</span></span><span className={`tabular ${i.voided ? "text-muted line-through" : ""}`}>{money(i.amountCents)}</span></li>)}</ul></div>}
      </Drawer>
    </div>
  );
}
