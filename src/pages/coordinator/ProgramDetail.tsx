import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Pause, Play, XCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { categoryLabel } from "@shared/constants";
import { Badge, Button, Card, CardHeader, ConfirmDialog, DL, ErrorState, Field, Input, MetricCard, PageHeader, PageSkeleton, StatusBadge, Tabs, Textarea, Notice, DataTable, EmptyState, FilterSelect, Pagination, SearchInput } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useProgram } from "@/lib/program";
import { useList } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { fmtDate, money, num, pct } from "@/lib/utils";

const schema = z.object({ name: z.string().trim().min(3, "Name is required"), description: z.string().max(1000), endDate: z.string().min(1, "End date is required"), budget: z.number({ error: "Enter a budget" }).positive("Budget must be greater than zero"), restrictHomeCommunity: z.boolean() });
type V = z.infer<typeof schema>;

export default function ProgramDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<any>(`/api/programs/${id}`);
  const { reload: reloadPrograms } = useProgram();
  const toast = useToast();
  const [confirm, setConfirm] = useState<null | "active" | "paused" | "closed">(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "communities" | "residents" | "financial" | "allocations">("overview");
  const allocs = useList<any>("/api/allocations", {}, { programId: id, status: "all" }, 10);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting, isDirty } } = useForm<V>({ resolver: zodResolver(schema), values: data ? { name: data.program.name, description: data.program.description, endDate: data.program.endDate, budget: data.program.budgetCents / 100, restrictHomeCommunity: data.program.restrictHomeCommunity } : undefined });
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error ?? "Not found"} onRetry={reload} />;
  const p = data.program;
  const closed = p.status === "closed";

  const save = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await api.patch(`/api/programs/${p.id}`, { name: v.name, description: v.description, endDate: v.endDate, budgetCents: Math.round(v.budget * 100), restrictHomeCommunity: v.restrictHomeCommunity });
      toast.success("Program updated"); reload(); reloadPrograms(); reset(v);
    } catch (e) { setFormError(e instanceof Error ? e.message : "Could not save"); }
  });
  const change = async (status: string, reason: string) => { await api.post(`/api/programs/${p.id}/status`, { status, reason }); toast.success(`Program ${status === "active" ? "is now active" : status}`); reload(); reloadPrograms(); };
  const verb = { active: p.status === "paused" ? "Resume" : "Activate", paused: "Pause", closed: "Close" } as const;

  return (
    <div>
      <Link to="/app/programs" className="mb-3 inline-flex items-center gap-1 text-sm text-secondary hover:text-ink"><ArrowLeft className="size-4" />Relief Programs</Link>
      <PageHeader eyebrow="Aid operations / Relief Programs" title={p.name} subtitle={<>{p.emergencyType} · {p.region} · {fmtDate(p.startDate)} – {fmtDate(p.endDate)} <StatusBadge status={p.status} /></>}
        actions={!closed && <>
          {(p.status === "draft" || p.status === "paused") && <Button onClick={() => setConfirm("active")}><Play className="size-4" />{verb.active}</Button>}
          {p.status === "active" && <Button variant="outline" onClick={() => setConfirm("paused")}><Pause className="size-4" />Pause</Button>}
          <Button variant="outline" className="text-danger" onClick={() => setConfirm("closed")}><XCircle className="size-4" />Close</Button></>} />
      {closed && <Notice tone="warning" className="mb-4">This program is closed. It is read-only and cannot issue new assistance.</Notice>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "overview", label: "Overview" }, { value: "communities", label: "Communities" }, { value: "residents", label: "Residents" }, { value: "financial", label: "Financial activity" }, { value: "allocations", label: "Allocations" }]} />
      <div className="mt-6">
      {tab === "financial" && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Budget" value={money(p.budgetCents)} /><MetricCard label="Issued as vouchers" value={money(p.issuedCents)} sub={`${money(p.budgetCents - p.issuedCents)} unissued`} /><MetricCard label="Redeemed" value={money(p.redeemedCents)} /><MetricCard label="Outstanding claims" value={money(p.outstandingClaimsCents)} /></div>}
      {tab === "communities" && <ProgramCommunities programId={p.id} />}
      {tab === "residents" && <ProgramResidents programId={p.id} />}
      {tab === "allocations" && <Card><CardHeader title="Allocation runs" /><DataTable loading={allocs.loading} rows={allocs.data?.items ?? []} rowKey={(r: any) => r.id} caption="Allocation runs" empty={<p className="p-5 text-sm text-secondary">No allocation runs for this program yet.</p>} columns={[{ key: "id", header: "Run", render: (r: any) => <Link to={`/app/allocations/${r.id}`} className="font-medium hover:underline">{r.id}</Link> }, { key: "s", header: "Status", render: (r: any) => <StatusBadge status={r.status} /> }, { key: "t", header: "Recommended", align: "right", render: (r: any) => money(r.totalRecommendedCents) }]} /></Card>}
      {tab === "overview" && <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Budget" value={money(p.budgetCents)} /><MetricCard label="Issued as vouchers" value={money(p.issuedCents)} sub={`${money(p.budgetCents - p.issuedCents)} unissued`} />
        <MetricCard label="Redeemed" value={money(p.redeemedCents)} /><MetricCard label="Outstanding claims" value={money(p.outstandingClaimsCents)} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Program settings" subtitle="The budget can never be set below what is already issued or allocated." />
          <form onSubmit={save} className="grid gap-4 p-5 sm:grid-cols-2" noValidate>
            <div className="sm:col-span-2"><Field label="Name" error={errors.name?.message} htmlFor="n"><Input id="n" disabled={closed} {...register("name")} /></Field></div>
            <Field label="Budget (USD)" error={errors.budget?.message} htmlFor="b"><Input id="b" type="number" step="0.01" disabled={closed} {...register("budget", { valueAsNumber: true })} /></Field>
            <Field label="End date" error={errors.endDate?.message} htmlFor="e"><Input id="e" type="date" disabled={closed} {...register("endDate")} /></Field>
            <div className="sm:col-span-2"><Field label="Description" htmlFor="d"><Textarea id="d" disabled={closed} {...register("description")} /></Field></div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-teal" disabled={closed} {...register("restrictHomeCommunity")} />Restrict redemptions to the resident’s home community</label>
            {formError && <p role="alert" className="text-sm font-medium text-danger sm:col-span-2">{formError}</p>}
            {!closed && <div className="sm:col-span-2"><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save changes</Button></div>}
          </form>
        </Card>
        <div className="space-y-6">
          <Card><CardHeader title="Communities" /><ul className="divide-y divide-line">{data.communities.map((c: any) => <li key={c.id}><Link to={`/app/communities/${c.id}`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-canvas"><span className="font-medium">{c.name}</span><span className="text-muted">{c.populationNeeding.toLocaleString()} in need</span></Link></li>)}</ul></Card>
          <Card><CardHeader title="Eligible categories" /><div className="flex flex-wrap gap-1.5 p-5">{p.categories.map((c: string) => <Badge key={c} tone="teal">{categoryLabel(c)}</Badge>)}</div></Card>
          <Card><CardHeader title="Details" /><div className="p-5"><DL items={[["Program ID", p.id], ["Residents", p.residentCount], ["Allocated (plan)", money(p.allocatedCents)], ["Created", fmtDate(p.createdAt)]]} /></div></Card>
        </div>
      </div>
      </>}
      </div>
      {confirm && <ConfirmDialog open onOpenChange={(o) => !o && setConfirm(null)} danger={confirm === "closed"} title={`${verb[confirm]} this program?`}
        description={confirm === "closed" ? "Closing is permanent: the program becomes read-only and no more vouchers can be issued." : confirm === "paused" ? "While paused, no new vouchers can be issued. Existing vouchers remain redeemable." : "Vouchers can be issued once the program is active."}
        confirmLabel={verb[confirm]} requireReason={confirm === "closed" ? "Reason for closing" : undefined} onConfirm={(r) => change(confirm, r)} />}
    </div>
  );
}


/** Per-community market metrics for this program, straight from the live allocation engine (same numbers as Intelligence). */
function ProgramCommunities({ programId }: { programId: string }) {
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi<{ items: any[] }>(`/api/communities?programId=${programId}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <Card>
      <CardHeader title="Participating communities" subtitle="Market metrics are calculated live by the allocation engine; recommended shares are the engine's current recommendation." />
      <DataTable loading={loading} rows={(data?.items ?? []).filter((c) => c.live)} rowKey={(r: any) => r.id} onRowClick={(r: any) => nav(`/app/communities/${r.id}`)} caption="Program communities"
        empty={<EmptyState title="No communities" message="This program has no participating communities." />}
        columns={[
          { key: "n", header: "Community", render: (r: any) => r.name },
          { key: "p", header: "Needing aid", align: "right", render: (r: any) => num(r.live.populationNeeding) },
          { key: "v", header: "Market viability", align: "right", render: (r: any) => r.live.marketViability.toFixed(2) },
          { key: "m", header: "Merchant coverage", align: "right", hideOnMobile: true, render: (r: any) => `${r.live.merchantCoverage}%` },
          { key: "i", header: "Inventory coverage", align: "right", hideOnMobile: true, render: (r: any) => pct(r.live.inventoryCoverage) },
          { key: "vp", header: "Vouchers", align: "right", render: (r: any) => pct(r.live.voucherPct) },
          { key: "dp", header: "Direct supply", align: "right", render: (r: any) => pct(r.live.directPct) },
        ]} />
    </Card>
  );
}

/** Residents registered to this program only (the API filters by program_id). */
function ProgramResidents({ programId }: { programId: string }) {
  const nav = useNavigate();
  const [community, setCommunity] = useState("all"), [status, setStatus] = useState("all");
  const list = useList<any>("/api/residents", { sort: "id", dir: "asc" }, { programId, communityId: community, status }, 10);
  const comms = useApi<{ items: any[] }>(`/api/communities?programId=${programId}`);
  const filtered = !!list.q || community !== "all" || status !== "all";
  return (
    <Card>
      <CardHeader title="Program residents" subtitle="Only residents registered to this program are listed. Select a row for the full record." />
      <div className="flex flex-wrap gap-3 border-b border-line p-4">
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search by name or ID" className="w-full sm:w-72" />
        <FilterSelect label="Community" value={community} onChange={setCommunity} options={[{ value: "all", label: "All communities" }, ...(comms.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }]} />
      </div>
      {list.error ? <div className="p-5"><ErrorState error={list.error} onRetry={list.reload} /></div> : (
        <DataTable loading={list.loading} rows={list.data?.items} rowKey={(r: any) => r.id} onRowClick={(r: any) => nav(`/app/residents/${r.id}`)} sort={list.sort} onSort={list.onSort} caption="Program residents"
          empty={<EmptyState title={filtered ? "No matching residents" : "No residents yet"} message={filtered ? "Try a different search or clear the filters." : "Residents registered to this program will appear here."} />}
          columns={[
            { key: "name", header: "Resident", sortable: true, render: (r: any) => r.name },
            { key: "id", header: "ID", sortable: true, hideOnMobile: true, render: (r: any) => <span className="font-mono text-xs">{r.id}</span> },
            { key: "community", header: "Community", sortable: true, hideOnMobile: true, render: (r: any) => r.communityName },
            { key: "issued", header: "Issued", sortable: true, align: "right", hideOnMobile: true, render: (r: any) => money(r.issuedCents) },
            { key: "redeemed", header: "Redeemed", sortable: true, align: "right", hideOnMobile: true, render: (r: any) => money(r.redeemedCents) },
            { key: "balance", header: "Balance", sortable: true, align: "right", render: (r: any) => <strong>{money(r.balanceCents)}</strong> },
            { key: "status", header: "Status", render: (r: any) => <StatusBadge status={r.status} /> },
          ]} />
      )}
      {list.data && <Pagination page={list.page} pageSize={list.data.pageSize} total={list.data.total} onPage={list.setPage} />}
    </Card>
  );
}
