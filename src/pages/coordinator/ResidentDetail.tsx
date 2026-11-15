import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Ticket } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";
import { CATEGORIES } from "@shared/constants";
import { CategoryChips } from "@/components/domain";
import { Button, Card, CardHeader, DataTable, ErrorState, Field, Input, MetricCard, Modal, Notice, PageHeader, PageSkeleton, StatusBadge } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtDate, fmtDateTime, money } from "@/lib/utils";

const schema = z.object({ amount: z.number({ error: "Enter an amount" }).positive("Amount must be greater than zero").max(10_000, "Maximum $10,000 per voucher"), categories: z.array(z.string()).min(1, "Select at least one category"), expiresAt: z.string() });
type V = z.infer<typeof schema>;

export default function ResidentDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<any>(`/api/residents/${id}`);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const { register, control, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(schema), defaultValues: { amount: undefined as unknown as number, categories: CATEGORIES.map((c) => c.id), expiresAt: "" } });
  if (loading) return <PageSkeleton cards={3} />;
  if (error || !data) return <ErrorState error={error ?? "Not found"} onRetry={reload} />;
  const r = data.resident;
  const submit = handleSubmit(async (v) => {
    try { const res = await api.post(`/api/residents/${r.id}/vouchers`, { amountCents: Math.round(v.amount * 100), eligibleCategories: v.categories, ...(v.expiresAt ? { expiresAt: v.expiresAt } : {}) }); toast.success(`Voucher ${res.voucher.code} issued for ${money(res.voucher.amountCents)}`); setOpen(false); reset(); reload(); }
    catch (e) { setError("root", { message: e instanceof Error ? e.message : "Could not issue assistance" }); }
  });
  const canIssue = r.status === "active";
  return (
    <div>
      <Link to="/app/residents" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Residents</Link>
      <PageHeader title={r.name} subtitle={<>{r.id} · {r.communityName} · household of {r.householdSize} <StatusBadge status={r.status} /></>} actions={<Button onClick={() => setOpen(true)} disabled={!canIssue}><Ticket className="size-4" />Issue assistance</Button>} />
      {!canIssue && <Notice tone="warning" className="mb-4">This resident is suspended. Assistance cannot be issued.</Notice>}
      <div className="grid gap-4 sm:grid-cols-3"><MetricCard label="Available balance" value={money(r.balanceCents)} /><MetricCard label="Issued" value={money(r.issuedCents)} /><MetricCard label="Redeemed" value={money(r.redeemedCents)} /></div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card><CardHeader title="Vouchers" />
          <DataTable rows={data.vouchers} rowKey={(v: any) => v.id} caption="Vouchers" empty={<p className="p-5 text-sm text-muted">No vouchers issued yet.</p>} columns={[
            { key: "c", header: "Code", render: (v: any) => <span className="font-mono text-xs">{v.code}</span> },
            { key: "e", header: "Categories", hideOnMobile: true, render: (v: any) => <CategoryChips cats={v.eligibleCategories.slice(0, 2)} /> },
            { key: "a", header: "Remaining", align: "right", render: (v: any) => `${money(v.remainingCents)} / ${money(v.amountCents)}` },
            { key: "x", header: "Expires", render: (v: any) => fmtDate(v.expiresAt) },
            { key: "s", header: "Status", render: (v: any) => <StatusBadge status={v.status} /> },
          ]} />
        </Card>
        <Card><CardHeader title="Redemption history" />
          <DataTable rows={data.redemptions} rowKey={(x: any) => x.id} caption="Redemptions" empty={<p className="p-5 text-sm text-muted">No redemptions yet.</p>} columns={[
            { key: "t", header: "Receipt", render: (x: any) => <span><span className="font-medium">{x.receiptNo}</span><span className="block text-xs text-muted">{fmtDateTime(x.createdAt)}</span></span> },
            { key: "m", header: "Merchant", hideOnMobile: true, render: (x: any) => x.merchantName },
            { key: "a", header: "Amount", align: "right", render: (x: any) => money(x.amountCents) },
            { key: "s", header: "Status", render: (x: any) => <StatusBadge status={x.status} /> },
          ]} />
        </Card>
      </div>
      <Modal open={open} onOpenChange={setOpen} wide title={`Issue assistance to ${r.name}`} description="Creates a voucher and a ledger entry together. This cannot be edited afterwards; mistakes are corrected with reversals."
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={isSubmitting} onClick={submit}>Issue voucher</Button></>}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (USD)" error={errors.amount?.message} htmlFor="i-amt"><Input id="i-amt" type="number" step="0.01" inputMode="decimal" {...register("amount", { valueAsNumber: true })} aria-invalid={!!errors.amount} /></Field>
            <Field label="Expires (optional)" hint="Defaults to 30 days, capped at the program end." htmlFor="i-exp"><Input id="i-exp" type="date" {...register("expiresAt")} /></Field>
          </div>
          <fieldset><legend className="mb-1.5 text-sm font-medium">Eligible categories</legend>
            <Controller control={control} name="categories" render={({ field }) => <div className="flex flex-wrap gap-2">{CATEGORIES.map((c) => { const on = field.value.includes(c.id); return <label key={c.id} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${on ? "border-evergreen bg-teal-soft text-teal-dark" : "border-line"}`}><input type="checkbox" className="sr-only" checked={on} onChange={() => field.onChange(on ? field.value.filter((x) => x !== c.id) : [...field.value, c.id])} />{c.label}</label>; })}</div>} />
            {errors.categories && <p role="alert" className="mt-1 text-xs font-medium text-danger">{errors.categories.message}</p>}</fieldset>
          {errors.root && <p role="alert" className="text-sm font-medium text-danger">{errors.root.message}</p>}
        </form>
      </Modal>
    </div>
  );
}
