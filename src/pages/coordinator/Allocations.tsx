import { GitCompare } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, DataTable, ErrorState, FilterSelect, PageHeader, Pagination, StatusBadge, Modal, Select, Field } from "@/components/ui";
import { ScenarioDeltaTable } from "@/components/domain";
import { api } from "@/lib/api";
import { useList } from "@/lib/hooks";
import { useProgram } from "@/lib/program";
import { useToast } from "@/lib/toast";
import { fmtDateTime, money } from "@/lib/utils";

export default function Allocations() {
  const { programId } = useProgram();
  const [status, setStatus] = useState("all");
  const list = useList<any>("/api/allocations", {}, { programId, status }, 10);
  const nav = useNavigate();
  const toast = useToast();
  const [cmp, setCmp] = useState<{ a: string; b: string } | null>(null);
  const [result, setResult] = useState<any>(null);
  const items = list.data?.items ?? [];
  const doCompare = async () => { if (!cmp) return; if (cmp.a === cmp.b) return toast.error("Pick two different runs."); try { setResult(await api.get(`/api/allocations/compare?a=${cmp.a}&b=${cmp.b}`)); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not compare"); } };
  return (
    <div>
      <PageHeader title="Allocations" subtitle="Recommended allocation plans. Approving a plan records a decision; it does not move money." actions={<Button variant="outline" disabled={items.length < 2} onClick={() => setCmp({ a: items[0]?.id, b: items[1]?.id })}><GitCompare className="size-4" />Compare runs</Button>} />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4"><FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All statuses" }, { value: "pending_approval", label: "Pending approval" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "superseded", label: "Superseded" }]} /></div>
        {list.error ? <div className="p-5"><ErrorState error={list.error} onRetry={list.reload} /></div> : (
          <DataTable loading={list.loading} rows={items} rowKey={(r) => r.id} onRowClick={(r) => nav(`/app/allocations/${r.id}`)} caption="Allocation runs"
            columns={[
              { key: "id", header: "Run", render: (r) => <span>{r.id}<span className="block text-xs font-normal text-muted">{fmtDateTime(r.createdAt)} · {r.analysisDays}-day window</span></span> },
              { key: "s", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              { key: "t", header: "Recommended", align: "right", render: (r) => money(r.totalRecommendedCents) },
              { key: "v", header: "Vouchers", align: "right", hideOnMobile: true, render: (r) => money(r.voucherCents) },
              { key: "d", header: "Direct supply", align: "right", hideOnMobile: true, render: (r) => money(r.directSupplyCents) },
              { key: "b", header: "By", hideOnMobile: true, render: (r) => r.createdByName ?? "System" },
            ]} />
        )}
        {list.data && <Pagination page={list.page} pageSize={list.data.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
      <Modal open={!!cmp} onOpenChange={(o) => { if (!o) { setCmp(null); setResult(null); } }} wide title="Compare allocation runs" footer={<><Button variant="outline" onClick={() => { setCmp(null); setResult(null); }}>Close</Button><Button onClick={doCompare}>Compare</Button></>}>
        {cmp && <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2">{(["a", "b"] as const).map((k) => <Field key={k} label={k === "a" ? "Before" : "After"} htmlFor={`cmp-${k}`}><Select id={`cmp-${k}`} value={cmp[k]} onChange={(e) => setCmp({ ...cmp, [k]: e.target.value })}>{items.map((r) => <option key={r.id} value={r.id}>{r.id} · {fmtDateTime(r.createdAt)}</option>)}</Select></Field>)}</div>{result && <ScenarioDeltaTable rows={result.comparison} />}</div>}
      </Modal>
    </div>
  );
}
