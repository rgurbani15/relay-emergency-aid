import { useState } from "react";
import { Badge, Card, DataTable, Drawer, ErrorState, FilterSelect, PageHeader, Pagination, SearchInput } from "@/components/ui";
import { useList } from "@/lib/hooks";
import { useProgram } from "@/lib/program";
import { fmtDateTime, titleCase } from "@/lib/utils";

export default function Audit() {
  const { programId } = useProgram();
  const [action, setAction] = useState("all"), [role, setRole] = useState("all");
  const list = useList<any>("/api/audit", {}, { programId, action, role }, 20);
  const [sel, setSel] = useState<any>(null);
  const groups: string[] = list.data?.groups ?? [];
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Append-only record of who did what. Entries cannot be edited or deleted." />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <SearchInput value={list.q} onChange={list.setQ} placeholder="Search actor, action, entity" className="w-full sm:w-72" />
          <FilterSelect label="Action type" value={action} onChange={setAction} options={[{ value: "all", label: "All actions" }, ...groups.map((g) => ({ value: g, label: titleCase(g) }))]} />
          <FilterSelect label="Actor role" value={role} onChange={setRole} options={[{ value: "all", label: "All roles" }, { value: "coordinator", label: "Coordinator" }, { value: "merchant", label: "Merchant" }, { value: "resident", label: "Resident" }, { value: "system", label: "System" }]} />
        </div>
        {list.error ? <div className="p-5"><ErrorState error={list.error} onRetry={list.reload} /></div> : (
          <DataTable loading={list.loading} rows={list.data?.items} rowKey={(r) => r.id} onRowClick={setSel} caption="Audit log"
            columns={[
              { key: "t", header: "Time", render: (r) => fmtDateTime(r.createdAt) },
              { key: "a", header: "Actor", render: (r) => <span>{r.actorName}<span className="block text-xs font-normal capitalize text-muted">{r.actorRole}</span></span> },
              { key: "x", header: "Action", render: (r) => <Badge tone="teal">{r.action}</Badge> },
              { key: "e", header: "Entity", hideOnMobile: true, render: (r) => <span className="text-muted">{r.entityType ? `${r.entityType} ${r.entityId ?? ""}` : "—"}</span> },
            ]} />
        )}
        {list.data && <Pagination page={list.page} pageSize={list.data.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
      <Drawer open={!!sel} onOpenChange={(o) => !o && setSel(null)} title={sel?.action ?? ""} subtitle={sel ? `${sel.actorName} · ${fmtDateTime(sel.createdAt)}` : undefined}>
        {sel && <div className="space-y-3 text-sm"><p><span className="text-muted">Entry</span> <span className="font-mono">{sel.id}</span></p><p><span className="text-muted">Entity</span> {sel.entityType ?? "—"} {sel.entityId ?? ""}</p><div><p className="mb-1 text-muted">Details</p><pre className="scroll-thin overflow-x-auto rounded-lg bg-canvas p-3 text-xs leading-relaxed">{JSON.stringify(sel.metadata, null, 2)}</pre></div></div>}
      </Drawer>
    </div>
  );
}
