import { zodResolver } from "@hookform/resolvers/zod";
import { Store } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button, Card, DataTable, ErrorState, Field, FilterSelect, Input, Modal, PageHeader, Pagination, ProgressBar, SearchInput, Select, StatusBadge } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useList } from "@/lib/hooks";
import { useProgram } from "@/lib/program";
import { useToast } from "@/lib/toast";
import { money } from "@/lib/utils";

const schema = z.object({ name: z.string().trim().min(2, "Name is required"), communityId: z.string().min(1, "Select a community"), category: z.string().trim().min(2, "Business type is required"), capacityScore: z.number({ error: "0–100" }).int().min(0).max(100), status: z.enum(["open", "limited", "closed"]) });
type V = z.infer<typeof schema>;

export default function Merchants() {
  const { programId } = useProgram();
  const [community, setCommunity] = useState("all"), [status, setStatus] = useState("all"), [part, setPart] = useState("all");
  const list = useList<any>("/api/merchants", { sort: "id" }, { communityId: community, status, participating: part }, 12);
  const comms = useApi<{ items: any[] }>(programId ? `/api/communities?programId=${programId}` : null);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(schema), defaultValues: { name: "", communityId: "", category: "Grocery", capacityScore: 60, status: "open" } });
  const submit = handleSubmit(async (v) => {
    try { const r = await api.post("/api/merchants", v); toast.success(`${r.merchant.name} registered as ${r.merchant.id}`); setOpen(false); reset(); list.reload(); }
    catch (e) { setError("root", { message: e instanceof Error ? e.message : "Could not register" }); }
  });
  return (
    <div>
      <PageHeader title="Merchants" subtitle="Participating businesses, operating status and capacity." actions={<Button onClick={() => setOpen(true)}><Store className="size-4" />Register merchant</Button>} />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <SearchInput value={list.q} onChange={list.setQ} placeholder="Search merchants" className="w-full sm:w-64" />
          <FilterSelect label="Community" value={community} onChange={setCommunity} options={[{ value: "all", label: "All communities" }, ...(comms.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All statuses" }, { value: "open", label: "Open" }, { value: "limited", label: "Limited" }, { value: "closed", label: "Closed" }]} />
          <FilterSelect label="Participation" value={part} onChange={setPart} options={[{ value: "all", label: "Any participation" }, { value: "1", label: "Participating" }, { value: "0", label: "Not participating" }]} />
        </div>
        {list.error ? <div className="p-5"><ErrorState error={list.error} onRetry={list.reload} /></div> : (
          <DataTable loading={list.loading} rows={list.data?.items} rowKey={(r) => r.id} onRowClick={(r) => nav(`/app/merchants/${r.id}`)} sort={list.sort} onSort={list.onSort} caption="Merchants"
            columns={[
              { key: "name", header: "Merchant", sortable: true, render: (r) => <span>{r.name}<span className="block text-xs font-normal text-muted">{r.id} · {r.category}</span></span> },
              { key: "community", header: "Community", sortable: true, hideOnMobile: true, render: (r) => r.communityName },
              { key: "status", header: "Status", render: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{!r.participating && <StatusBadge status="inactive" label="Not participating" />}</span> },
              { key: "capacity", header: "Capacity", sortable: true, hideOnMobile: true, render: (r) => <div className="w-24"><span className="text-xs text-muted">{r.capacityScore}/100</span><ProgressBar value={r.capacityScore / 100} className="mt-1" /></div> },
              { key: "redemptions", header: "Redemptions", sortable: true, align: "right", hideOnMobile: true, render: (r) => r.redemptionCount },
              { key: "outstanding", header: "Outstanding", sortable: true, align: "right", render: (r) => money(r.outstandingCents) },
            ]} />
        )}
        {list.data && <Pagination page={list.page} pageSize={list.data.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
      <Modal open={open} onOpenChange={setOpen} title="Register merchant" description="Adds a business and a demo merchant sign-in."
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={isSubmitting} onClick={submit}>Register</Button></>}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Business name" error={errors.name?.message} htmlFor="m-name"><Input id="m-name" {...register("name")} /></Field>
          <Field label="Business type" error={errors.category?.message} htmlFor="m-cat"><Input id="m-cat" {...register("category")} /></Field>
          <Field label="Community" error={errors.communityId?.message} htmlFor="m-com"><Select id="m-com" {...register("communityId")}><option value="">Select…</option>{(comms.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-4"><Field label="Capacity (0–100)" error={errors.capacityScore?.message} htmlFor="m-cap"><Input id="m-cap" type="number" {...register("capacityScore", { valueAsNumber: true })} /></Field><Field label="Status" htmlFor="m-st"><Select id="m-st" {...register("status")}><option value="open">Open</option><option value="limited">Limited</option><option value="closed">Closed</option></Select></Field></div>
          {errors.root && <p role="alert" className="text-sm font-medium text-danger">{errors.root.message}</p>}
        </form>
      </Modal>
    </div>
  );
}
