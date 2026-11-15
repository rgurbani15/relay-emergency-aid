import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button, Card, DataTable, ErrorState, Field, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, Select, StatusBadge } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useList } from "@/lib/hooks";
import { useProgram } from "@/lib/program";
import { useToast } from "@/lib/toast";
import { money } from "@/lib/utils";

const schema = z.object({ name: z.string().trim().min(2, "Name is required"), communityId: z.string().min(1, "Select a community"), householdSize: z.number({ error: "Enter a number" }).int().min(1, "At least 1").max(20) });
type V = z.infer<typeof schema>;

export default function Residents() {
  const { programId, program } = useProgram();
  const [community, setCommunity] = useState("all");
  const [status, setStatus] = useState("all");
  const list = useList<any>("/api/residents", { sort: "id", dir: "asc" }, { programId, communityId: community, status }, 12);
  const comms = useApi<{ items: any[] }>(programId ? `/api/communities?programId=${programId}` : null);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(schema), defaultValues: { name: "", communityId: "", householdSize: 1 } });
  const submit = handleSubmit(async (v) => {
    try { const r = await api.post("/api/residents", { ...v, programId }); toast.success(`${r.resident.name} registered as ${r.resident.id}`); setOpen(false); reset(); list.reload(); }
    catch (e) { setError("root", { message: e instanceof Error ? e.message : "Could not register" }); }
  });
  return (
    <div>
      <PageHeader title="Residents" subtitle={`Registered residents in ${program?.name ?? "the selected program"}.`} actions={<Button onClick={() => setOpen(true)} disabled={program?.status === "closed"}><UserPlus className="size-4" />Register resident</Button>} />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <SearchInput value={list.q} onChange={list.setQ} placeholder="Search by name or ID" className="w-full sm:w-72" />
          <FilterSelect label="Community" value={community} onChange={setCommunity} options={[{ value: "all", label: "All communities" }, ...(comms.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }]} />
        </div>
        {list.error ? <div className="p-5"><ErrorState error={list.error} onRetry={list.reload} /></div> : (
          <DataTable loading={list.loading} rows={list.data?.items} rowKey={(r) => r.id} onRowClick={(r) => nav(`/app/residents/${r.id}`)} sort={list.sort} onSort={list.onSort} caption="Residents"
            columns={[
              { key: "name", header: "Resident", sortable: true, render: (r) => <span>{r.name}<span className="block text-xs font-normal text-muted">{r.id} · household of {r.householdSize}</span></span> },
              { key: "community", header: "Community", sortable: true, hideOnMobile: true, render: (r) => r.communityName },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              { key: "issued", header: "Issued", sortable: true, align: "right", hideOnMobile: true, render: (r) => money(r.issuedCents) },
              { key: "redeemed", header: "Redeemed", sortable: true, align: "right", hideOnMobile: true, render: (r) => money(r.redeemedCents) },
              { key: "balance", header: "Balance", sortable: true, align: "right", render: (r) => <strong>{money(r.balanceCents)}</strong> },
            ]} />
        )}
        {list.data && <Pagination page={list.page} pageSize={list.data.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
      <Modal open={open} onOpenChange={setOpen} title="Register resident" description="Creates a resident record and a demo sign-in. No personal documents are collected."
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={isSubmitting} onClick={submit}>Register</Button></>}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Full name" error={errors.name?.message} htmlFor="r-name"><Input id="r-name" {...register("name")} /></Field>
          <Field label="Community" error={errors.communityId?.message} htmlFor="r-com"><Select id="r-com" {...register("communityId")}><option value="">Select…</option>{(comms.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Household size" error={errors.householdSize?.message} htmlFor="r-hh"><Input id="r-hh" type="number" {...register("householdSize", { valueAsNumber: true })} /></Field>
          {errors.root && <p role="alert" className="text-sm font-medium text-danger">{errors.root.message}</p>}
        </form>
      </Modal>
    </div>
  );
}
