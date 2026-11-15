import { ArrowLeft, Check, Download, X } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FormulaPanel, InfoTip, RecommendationCard } from "@/components/domain";
import { Button, ConfirmDialog, DL, ErrorState, MetricCard, Notice, PageHeader, PageSkeleton, Section, StatusBadge, Card, CardHeader } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useProgram } from "@/lib/program";
import { useToast } from "@/lib/toast";
import { downloadFile, fmtDateTime, money } from "@/lib/utils";

export default function AllocationDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<any>(`/api/allocations/${id}`);
  const { reload: reloadPrograms } = useProgram();
  const toast = useToast();
  const [mode, setMode] = useState<null | "approve" | "reject">(null);
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error ?? "Not found"} onRetry={reload} />;
  const r = data.run;
  const pending = r.status === "pending_approval";
  const exportCsv = async () => { const res = await fetch(`/api/allocations/${r.id}/export`, { credentials: "same-origin" }); if (!res.ok) return toast.error("Export failed"); downloadFile(`relay-allocation-${r.id}.csv`, await res.text()); };
  return (
    <div>
      <Link to="/app/allocations" className="mb-3 inline-flex items-center gap-1 text-sm text-secondary hover:text-ink"><ArrowLeft className="size-4" />Allocations</Link>
      <PageHeader eyebrow="Intelligence / Allocations" title={`Allocation ${r.id}`} subtitle={<>{r.programName} · generated {fmtDateTime(r.createdAt)} <StatusBadge status={r.status} /></>}
        actions={<><Button variant="outline" onClick={exportCsv}><Download className="size-4" />Export CSV</Button>{pending && <><Button variant="outline" className="text-danger" onClick={() => setMode("reject")}><X className="size-4" />Reject</Button><Button onClick={() => setMode("approve")}><Check className="size-4" />Approve plan</Button></>}</>} />
      {pending && <Notice tone="info" className="mb-6">Awaiting human approval. Approving records this plan as the program’s allocation. It does not issue vouchers, purchase supplies or move money.</Notice>}
      {r.status === "rejected" && <Notice tone="warning" className="mb-4">Rejected {fmtDateTime(r.decidedAt)}: {r.decisionReason}</Notice>}
      {data.scenario && <Notice tone="info" className="mb-4">Generated from the saved scenario “{data.scenario.name}”.</Notice>}
      <Section n="01" title="Summary">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Total recommended" value={money(r.totalRecommendedCents)} /><MetricCard label="As vouchers" value={money(r.voucherCents)} /><MetricCard label="As direct supply" value={money(r.directSupplyCents)} /><MetricCard label="Unallocated" value={money(r.unallocatedCents)} sub={`Budget basis ${money(r.budgetBasisCents)}`} /></div>
      </Section>
      <Section n="02" title="Community recommendations">
        <div className="space-y-4">{data.recommendations.map((c: any) => <RecommendationCard key={c.communityId} c={c} />)}</div>
      </Section>
      {data.notes.length > 0 && <Section n="03" title="Scenario notes"><Card><ul className="list-disc space-y-1 p-5 pl-9 text-sm text-secondary">{data.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></Card></Section>}
      <Section n="04" title="Approval history">
      <Card><div className="p-5"><DL items={[["Status", <StatusBadge key="s" status={r.status} />], ["Analysis window", `${r.analysisDays} days`], ["Communities evaluated", r.communitiesEvaluated], ["Decided at", r.decidedAt ? fmtDateTime(r.decidedAt) : "—"]]} /></div></Card>
      </Section>
      <Section n="05" title="Methodology"><FormulaPanel formulas={data.formulas} /></Section>
      <div className="mt-4"><InfoTip>Recommendations are transparent decision rules on synthetic data, not validated predictions.</InfoTip></div>
      <ConfirmDialog open={mode === "approve"} onOpenChange={(o) => !o && setMode(null)} title="Approve this allocation plan?" description={`This records ${money(r.totalRecommendedCents)} as the program’s approved allocation and supersedes any earlier approved plan. No money moves.`} confirmLabel="Approve plan"
        onConfirm={async () => { await api.post(`/api/allocations/${r.id}/approve`); toast.success("Allocation approved"); reload(); reloadPrograms(); }} />
      <ConfirmDialog open={mode === "reject"} onOpenChange={(o) => !o && setMode(null)} danger title="Reject this allocation plan?" confirmLabel="Reject plan" requireReason="Reason for rejection"
        onConfirm={async (reason) => { await api.post(`/api/allocations/${r.id}/reject`, { reason }); toast.success("Allocation rejected"); reload(); }} />
    </div>
  );
}
