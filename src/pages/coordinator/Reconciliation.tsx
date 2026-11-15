import { Check, X } from "lucide-react";
import { useState } from "react";
import { Button, Card, ConfirmDialog, DataTable, Drawer, ErrorState, FilterSelect, MetricCard, Notice, PageHeader, Pagination, SearchInput, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { useList } from "@/lib/hooks";
import { useProgram } from "@/lib/program";
import { useToast } from "@/lib/toast";
import { fmtDateTime, money } from "@/lib/utils";

export default function Reconciliation() {
  const { programId } = useProgram();
  const [status, setStatus] = useState("all");
  const list = useList<any>("/api/reconciliation", {}, { programId, status }, 10);
  const [sel, setSel] = useState<any>(null);
  const [mode, setMode] = useState<null | "approve" | "reject">(null);
  const toast = useToast();
  const s = list.data?.summary;
  const open = async (c: any) => { try { setSel(await api.get(`/api/reconciliation/claims/${c.id}`)); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not load claim"); } };
  const after = () => { setSel(null); list.reload(); };
  return (
    <div>
      <PageHeader title="Reconciliation" subtitle="Merchant reimbursement claims created by redemptions." />
      <Notice tone="info" className="mb-4">Approving a claim records that it is valid. RELAY has no payout integration and no real money moves.</Notice>
      {s && <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Total claims" value={money(s.totalClaims.cents)} sub={`${s.totalClaims.count} claims`} /><MetricCard label="Pending review" value={money(s.pending.cents)} sub={`${s.pending.count} claims`} tone="warning" /><MetricCard label="Approved" value={money(s.approved.cents)} sub={`${s.approved.count} claims`} tone="success" /><MetricCard label="Rejected" value={money(s.rejected.cents)} sub={`${s.rejected.count} claims`} tone="danger" /></div>}
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4"><SearchInput value={list.q} onChange={list.setQ} placeholder="Search claim or merchant" className="w-full sm:w-64" /><FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All statuses" }, { value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }]} /></div>
        {list.error ? <div className="p-5"><ErrorState error={list.error} onRetry={list.reload} /></div> : (
          <DataTable loading={list.loading} rows={list.data?.items} rowKey={(r) => r.id} onRowClick={open} caption="Claims"
            columns={[
              { key: "id", header: "Claim", render: (r) => <span>{r.id}<span className="block text-xs font-normal text-muted">{fmtDateTime(r.createdAt)}</span></span> },
              { key: "m", header: "Merchant", render: (r) => r.merchantName },
              { key: "n", header: "Redemptions", align: "right", hideOnMobile: true, render: (r) => r.itemCount },
              { key: "a", header: "Amount", align: "right", render: (r) => money(r.amountCents) },
              { key: "s", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]} />
        )}
        {list.data && <Pagination page={list.page} pageSize={list.data.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
      <Drawer open={!!sel} onOpenChange={(o) => !o && setSel(null)} title={sel ? `Claim ${sel.claim.id}` : ""} subtitle={sel?.claim.merchantName}>
        {sel && <div className="space-y-4">
          <div className="flex items-center justify-between"><StatusBadge status={sel.claim.status} /><span className="tabular text-xl font-semibold text-navy">{money(sel.claim.amountCents)}</span></div>
          {sel.claim.rejectionReason && <Notice tone="warning">Rejected: {sel.claim.rejectionReason}</Notice>}
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">{sel.items.map((i: any) => <li key={i.redemptionId} className="flex items-center justify-between gap-3 px-3 py-2"><div><p className="font-medium">{i.receiptNo}</p><p className="text-xs text-muted">{fmtDateTime(i.createdAt)} · {i.voucherCode} · {i.residentId}</p></div><div className="text-right"><p className={`tabular ${i.voided ? "text-muted line-through" : ""}`}>{money(i.amountCents)}</p>{i.voided && <span className="text-xs text-danger">voided</span>}</div></li>)}</ul>
          {sel.claim.status === "pending" && <div className="flex gap-2"><Button className="flex-1" onClick={() => setMode("approve")}><Check className="size-4" />Approve</Button><Button variant="outline" className="flex-1 text-danger" onClick={() => setMode("reject")}><X className="size-4" />Reject</Button></div>}
        </div>}
      </Drawer>
      <ConfirmDialog open={mode === "approve"} onOpenChange={(o) => !o && setMode(null)} title="Approve this claim?" description="This marks the claim valid. It does not pay the merchant." confirmLabel="Approve claim" onConfirm={async () => { await api.post(`/api/reconciliation/claims/${sel.claim.id}/approve`); toast.success("Claim approved"); after(); }} />
      <ConfirmDialog open={mode === "reject"} onOpenChange={(o) => !o && setMode(null)} danger title="Reject this claim?" description="The merchant receivable is reversed with new ledger entries; history is not edited." confirmLabel="Reject claim" requireReason="Reason for rejection" onConfirm={async (reason) => { await api.post(`/api/reconciliation/claims/${sel.claim.id}/reject`, { reason }); toast.success("Claim rejected"); after(); }} />
    </div>
  );
}
