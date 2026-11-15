import { useState } from "react";
import { Button, Card, ConfirmDialog, DataTable, Drawer, ErrorState, FilterSelect, Input, MetricCard, PageHeader, Pagination, SearchInput, StatusBadge, Badge } from "@/components/ui";
import { ReceiptView } from "@/components/domain";
import { api } from "@/lib/api";
import { useList } from "@/lib/hooks";
import { useProgram } from "@/lib/program";
import { useToast } from "@/lib/toast";
import { fmtDateTime, money, titleCase } from "@/lib/utils";

const TYPES = ["assistance_issued", "voucher_redeemed", "voucher_reversal", "reimbursement_claim_created", "reimbursement_claim_reversed"];
export default function Transactions() {
  const { programId } = useProgram();
  const [type, setType] = useState("all"), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const list = useList<any>("/api/transactions", {}, { programId, type, from, to }, 15);
  const [sel, setSel] = useState<any>(null);
  const [reverse, setReverse] = useState(false);
  const toast = useToast();
  const open = async (row: any) => {
    if (!row.redemptionId) { setSel({ row }); return; }
    try { setSel({ row, ...(await api.get(`/api/transactions/redemptions/${row.redemptionId}`)) }); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not load receipt"); }
  };
  const s = list.data?.summary ?? {};
  return (
    <div>
      <PageHeader title="Transactions" subtitle="The immutable ledger. Corrections appear as new reversal entries, never edits." />
      <div className="mb-4 grid gap-4 sm:grid-cols-3"><MetricCard label="Assistance issued" value={money(s.assistance_issued?.cents ?? 0)} sub={`${s.assistance_issued?.count ?? 0} entries`} /><MetricCard label="Vouchers redeemed" value={money(Math.abs(s.voucher_redeemed?.cents ?? 0))} sub={`${s.voucher_redeemed?.count ?? 0} entries`} /><MetricCard label="Reversals" value={`${(s.voucher_reversal?.count ?? 0)}`} sub="Posted as separate entries" /></div>
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <SearchInput value={list.q} onChange={list.setQ} placeholder="Search resident, merchant, memo" className="w-full sm:w-72" />
          <FilterSelect label="Type" value={type} onChange={setType} options={[{ value: "all", label: "All types" }, ...TYPES.map((t) => ({ value: t, label: titleCase(t) }))]} />
          <label className="flex items-center gap-2 text-sm text-muted">From<Input type="date" aria-label="From date" className="h-10 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="flex items-center gap-2 text-sm text-muted">To<Input type="date" aria-label="To date" className="h-10 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {list.error ? <div className="p-5"><ErrorState error={list.error} onRetry={list.reload} /></div> : (
          <DataTable loading={list.loading} rows={list.data?.items} rowKey={(r) => r.id} onRowClick={open} caption="Ledger entries"
            columns={[
              { key: "time", header: "Time", render: (r) => <span>{fmtDateTime(r.createdAt)}<span className="block text-xs font-normal text-muted">{r.id}</span></span> },
              { key: "type", header: "Type", render: (r) => <Badge tone={r.amountCents < 0 ? "warning" : "teal"}>{titleCase(r.type)}</Badge> },
              { key: "party", header: "Resident / merchant", hideOnMobile: true, render: (r) => r.residentName ?? r.merchantName ?? "—" },
              { key: "voucher", header: "Voucher", hideOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.voucherCode ?? "—"}</span> },
              { key: "amount", header: "Amount", align: "right", render: (r) => <span className={r.amountCents < 0 ? "text-danger" : ""}>{money(r.amountCents)}</span> },
            ]} />
        )}
        {list.data && <Pagination page={list.page} pageSize={list.data.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
      <Drawer open={!!sel} onOpenChange={(o) => !o && setSel(null)} title={sel?.receipt ? `Receipt ${sel.receipt.receiptNo}` : "Ledger entry"} subtitle={sel?.row?.id}>
        {sel?.receipt ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={sel.receipt.status} /><span className="text-sm text-muted">{sel.residentName} ({sel.residentId}) · claim {sel.receipt.claimId} ({sel.claimStatus})</span></div>
            <ReceiptView r={sel.receipt} printable />
            {sel.reversalReason && <p className="rounded-lg bg-danger-soft p-3 text-sm text-[#8a3630]">Reversed {fmtDateTime(sel.reversedAt)}: {sel.reversalReason}</p>}
            {sel.canReverse ? <Button variant="danger" onClick={() => setReverse(true)}>Reverse this redemption</Button> : sel.receipt.status === "completed" && <p className="text-xs text-muted">This redemption can no longer be reversed because its merchant claim has been decided.</p>}
          </div>
        ) : sel && (
          <dl className="space-y-2 text-sm">{[["Entry", sel.row.id], ["Type", titleCase(sel.row.type)], ["Account", sel.row.accountType], ["Amount", money(sel.row.amountCents)], ["Memo", sel.row.memo ?? "—"], ["Time", fmtDateTime(sel.row.createdAt)], ["Reverses", sel.row.reversesEntryId ?? "—"]].map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}</dl>
        )}
      </Drawer>
      <ConfirmDialog open={reverse} onOpenChange={setReverse} danger title="Reverse this redemption?" description="Restores the voucher balance and merchant stock and voids the claim line. Reversal entries are added to the ledger; the original entries stay unchanged." confirmLabel="Reverse redemption" requireReason="Reason for reversal"
        onConfirm={async (reason) => { await api.post(`/api/transactions/redemptions/${sel.receipt.redemptionId}/reverse`, { reason }); toast.success("Redemption reversed"); setSel(null); list.reload(); }} />
    </div>
  );
}
