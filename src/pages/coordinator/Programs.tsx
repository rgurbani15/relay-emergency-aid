import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { CATEGORIES } from "@shared/constants";
import { programCreateSchema } from "@shared/schemas";
import { Button, Card, DataTable, ErrorState, Field, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, Select, StatusBadge, Textarea, ProgressBar } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useList } from "@/lib/hooks";
import { useProgram } from "@/lib/program";
import { useToast } from "@/lib/toast";
import { fmtDate, money } from "@/lib/utils";

const formSchema = z.object({
  name: z.string().trim().min(3, "Name is required (3+ characters)").max(120),
  description: z.string().max(1000),
  emergencyType: z.string().trim().min(2, "Emergency type is required"),
  region: z.string().trim().min(2, "Region is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  budget: z.number({ error: "Enter a budget" }).positive("Budget must be greater than zero").max(100_000_000),
  communityIds: z.array(z.string()).min(1, "Select at least one community"),
  categories: z.array(z.string()).min(1, "Select at least one category"),
  status: z.enum(["draft", "active"]),
  restrictHomeCommunity: z.boolean(),
}).refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "End date must be on or after the start date" });
type FormValues = z.infer<typeof formSchema>;

export default function Programs() {
  const list = useList<any>("/api/programs", { sort: "start", dir: "desc" }, {}, 10);
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const { reload: reloadPrograms } = useProgram();
  const toast = useToast();
  const comms = useListCommunities();
  const { register, handleSubmit, control, reset, setError, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "", emergencyType: "Wildfire", region: "", startDate: new Date().toISOString().slice(0, 10), endDate: "", budget: undefined as unknown as number, communityIds: [], categories: CATEGORIES.map((c) => c.id), status: "draft", restrictHomeCommunity: true },
  });

  const submit = handleSubmit(async (v) => {
    try {
      const body = programCreateSchema.parse({ ...v, budgetCents: Math.round(v.budget * 100) });
      const r = await api.post("/api/programs", body);
      toast.success(`Program “${r.program.name}” created`);
      setOpen(false); reset(); reloadPrograms(); list.reload(); nav(`/app/programs/${r.program.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.details?.fieldErrors) for (const [k, m] of Object.entries<any>(e.details.fieldErrors)) setError((k === "budgetCents" ? "budget" : k) as keyof FormValues, { message: String(m[0]) });
      else toast.error(e instanceof Error ? e.message : "Could not create program");
    }
  });

  return (
    <div>
      <PageHeader title="Relief Programs" subtitle="Emergency assistance programs and their budgets." actions={<Button onClick={() => setOpen(true)}><Plus className="size-4" />New program</Button>} />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <SearchInput value={list.q} onChange={list.setQ} placeholder="Search programs" className="w-full sm:w-72" />
          <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); list.set({ status: v }); }} options={[{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "draft", label: "Draft" }, { value: "paused", label: "Paused" }, { value: "closed", label: "Closed" }]} />
        </div>
        {list.error ? <div className="p-5"><ErrorState error={list.error} onRetry={list.reload} /></div> : (
          <DataTable loading={list.loading} rows={list.data?.items} rowKey={(r) => r.id} onRowClick={(r) => nav(`/app/programs/${r.id}`)} sort={list.sort} onSort={list.onSort} caption="Programs"
            columns={[
              { key: "name", header: "Program", sortable: true, render: (r) => r.name },
              { key: "type", header: "Emergency type", hideOnMobile: true, render: (r) => r.emergencyType },
              { key: "region", header: "Region", hideOnMobile: true, render: (r) => r.region },
              { key: "status", header: "Status", sortable: true, render: (r) => <StatusBadge status={r.status} /> },
              { key: "budget", header: "Budget", sortable: true, align: "right", render: (r) => money(r.budgetCents) },
              { key: "allocated", header: "Allocated", sortable: true, align: "right", hideOnMobile: true, render: (r) => money(r.allocatedCents) },
              { key: "redeemed", header: "Redeemed", sortable: true, align: "right", hideOnMobile: true, render: (r) => <div className="ml-auto w-28"><span>{money(r.redeemedCents)}</span><ProgressBar value={r.budgetCents ? r.redeemedCents / r.budgetCents : 0} className="mt-1" /></div> },
              { key: "end", header: "Duration", sortable: true, hideOnMobile: true, render: (r) => <span className="whitespace-nowrap">{fmtDate(r.startDate)} – {fmtDate(r.endDate)}</span> },
            ]} />
        )}
        {list.data && <Pagination page={list.page} pageSize={list.data.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>

      <Modal open={open} onOpenChange={setOpen} wide title="Create program" description="Budgets are stored as whole cents. Draft programs cannot issue vouchers until activated."
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={isSubmitting} onClick={submit}>Create program</Button></>}>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <div className="sm:col-span-2"><Field label="Program name" error={errors.name?.message} htmlFor="p-name"><Input id="p-name" {...register("name")} aria-invalid={!!errors.name} /></Field></div>
          <Field label="Emergency type" error={errors.emergencyType?.message} htmlFor="p-type"><Input id="p-type" {...register("emergencyType")} /></Field>
          <Field label="Region" error={errors.region?.message} htmlFor="p-region"><Input id="p-region" {...register("region")} placeholder="e.g. Pine Valley County" /></Field>
          <Field label="Start date" error={errors.startDate?.message} htmlFor="p-start"><Input id="p-start" type="date" {...register("startDate")} /></Field>
          <Field label="End date" error={errors.endDate?.message} htmlFor="p-end"><Input id="p-end" type="date" {...register("endDate")} /></Field>
          <Field label="Budget (USD)" error={errors.budget?.message} htmlFor="p-budget"><Input id="p-budget" type="number" step="0.01" min="0" inputMode="decimal" {...register("budget", { valueAsNumber: true })} aria-invalid={!!errors.budget} /></Field>
          <Field label="Initial status" htmlFor="p-status"><Select id="p-status" {...register("status")}><option value="draft">Draft</option><option value="active">Active</option></Select></Field>
          <div className="sm:col-span-2"><Field label="Description" htmlFor="p-desc"><Textarea id="p-desc" {...register("description")} /></Field></div>
          <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-sm font-medium">Communities</legend>
            <Controller control={control} name="communityIds" render={({ field }) => (
              <div className="flex flex-wrap gap-2">{(comms.data?.items ?? []).map((c: any) => { const on = field.value.includes(c.id); return <label key={c.id} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${on ? "border-evergreen bg-teal-soft text-teal-dark" : "border-line"}`}><input type="checkbox" className="sr-only" checked={on} onChange={() => field.onChange(on ? field.value.filter((x) => x !== c.id) : [...field.value, c.id])} />{c.name}</label>; })}</div>
            )} />{errors.communityIds && <p role="alert" className="mt-1 text-xs font-medium text-danger">{errors.communityIds.message}</p>}</fieldset>
          <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-sm font-medium">Eligible categories</legend>
            <Controller control={control} name="categories" render={({ field }) => (
              <div className="flex flex-wrap gap-2">{CATEGORIES.map((c) => { const on = field.value.includes(c.id); return <label key={c.id} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${on ? "border-evergreen bg-teal-soft text-teal-dark" : "border-line"}`}><input type="checkbox" className="sr-only" checked={on} onChange={() => field.onChange(on ? field.value.filter((x) => x !== c.id) : [...field.value, c.id])} />{c.label}</label>; })}</div>
            )} />{errors.categories && <p role="alert" className="mt-1 text-xs font-medium text-danger">{errors.categories.message}</p>}</fieldset>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-teal" {...register("restrictHomeCommunity")} />Residents may only redeem at merchants in their own community</label>
        </form>
      </Modal>
    </div>
  );
}

import { useApi } from "@/lib/api";
function useListCommunities() { return useApi<{ items: any[] }>("/api/communities"); }
