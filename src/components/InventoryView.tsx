import { zodResolver } from "@hookform/resolvers/zod";
import { History, PackagePlus, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { CATEGORIES, categoryLabel } from "@shared/constants";
import { StockBadge } from "@/components/domain";
import { Button, Card, DataTable, Drawer, ErrorState, Field, FilterSelect, Input, Modal, Pagination, SearchInput, Select, Textarea, PageHeader, Badge } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useList } from "@/lib/hooks";
import { useProgram } from "@/lib/program";
import { useToast } from "@/lib/toast";
import { fmtDateTime, money, num } from "@/lib/utils";

const adjustSchema = z.object({ mode: z.enum(["set", "delta"]), value: z.number({ error: "Enter a whole number" }).int("Whole numbers only"), reason: z.enum(["restock", "adjustment", "correction"]), note: z.string().max(200) });
const addSchema = z.object({ merchantId: z.string(), name: z.string().trim().min(2, "Name is required"), category: z.string().min(1), quantity: z.number({ error: "Required" }).int().min(0), unit: z.string().trim().min(1, "Unit is required"), price: z.number({ error: "Required" }).positive("Must be greater than zero"), minThreshold: z.number({ error: "Required" }).int().min(0) });

export default function InventoryView({ role }: { role: "coordinator" | "merchant" }) {
  const coordinator = role === "coordinator";
  const { programId } = useProgram();
  const [category, setCategory] = useState("all"), [stock, setStock] = useState("all"), [community, setCommunity] = useState("all"), [merchant, setMerchant] = useState("all");
  const list = useList<any>("/api/inventory", { sort: coordinator ? "merchant" : "category" }, { category, stock, communityId: coordinator ? community : undefined, merchantId: coordinator ? merchant : undefined }, 14);
  const comms = useApi<{ items: any[] }>(coordinator && programId ? `/api/communities?programId=${programId}` : null);
  const merchants = useApi<{ items: any[] }>(coordinator ? "/api/merchants?pageSize=50" : null);
  const [adjust, setAdjust] = useState<any>(null), [history, setHistory] = useState<any>(null), [adding, setAdding] = useState(false);
  const toast = useToast();
  const s = list.data?.summary ?? {};

  return (
    <div>
      <PageHeader title="Inventory" subtitle={coordinator ? "Monitor essential supplies across participating merchants and communities." : "Your stock. Sales deduct automatically; manual changes are logged."} actions={<Button onClick={() => setAdding(true)}><PackagePlus className="size-4" />Add item</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">{(["healthy", "low", "critical", "out_of_stock"] as const).map((k) => <button key={k} onClick={() => setStock(stock === k ? "all" : k)} className={`rounded-md ring-1 transition ${stock === k ? "ring-teal" : "ring-transparent"}`} aria-pressed={stock === k}><Badge tone={k === "healthy" ? "success" : k === "low" ? "warning" : k === "critical" ? "danger" : "danger"}>{k.replaceAll("_", " ")}: {s[k] ?? 0}</Badge></button>)}</div>
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <SearchInput value={list.q} onChange={list.setQ} placeholder="Search items" className="w-full sm:w-64" />
          <FilterSelect label="Category" value={category} onChange={setCategory} options={[{ value: "all", label: "All categories" }, ...CATEGORIES.map((c) => ({ value: c.id, label: c.label }))]} />
          <FilterSelect label="Stock level" value={stock} onChange={setStock} options={[{ value: "all", label: "All levels" }, { value: "healthy", label: "Healthy" }, { value: "low", label: "Low" }, { value: "critical", label: "Critical" }, { value: "out_of_stock", label: "Out of stock" }]} />
          {coordinator && <FilterSelect label="Community" value={community} onChange={setCommunity} options={[{ value: "all", label: "All communities" }, ...(comms.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))]} />}
          {coordinator && <FilterSelect label="Merchant" value={merchant} onChange={setMerchant} options={[{ value: "all", label: "All merchants" }, ...(merchants.data?.items ?? []).map((m) => ({ value: m.id, label: m.name }))]} />}
        </div>
        {list.error ? <div className="p-5"><ErrorState error={list.error} onRetry={list.reload} /></div> : (
          <DataTable loading={list.loading} rows={list.data?.items} rowKey={(r) => r.id} sort={list.sort} onSort={list.onSort} caption="Inventory" rowClass={(r) => (r.status === "critical" || r.status === "out_of_stock" ? "bg-danger-soft/60" : r.status === "low" ? "bg-warning-soft/60" : undefined)}
            columns={[
              { key: "name", header: "Item", sortable: true, render: (r) => <span className="font-medium">{r.name}{coordinator && <span className="block text-xs font-normal text-muted">{r.merchantName} · {r.communityName}</span>}</span> },
              { key: "category", header: "Category", sortable: true, hideOnMobile: true, render: (r) => categoryLabel(r.category) },
              { key: "quantity", header: "In stock", sortable: true, align: "right", render: (r) => <span>{num(r.quantity)} <span className="text-xs text-muted">{r.unit}</span></span> },
              { key: "price", header: "Unit price", sortable: true, align: "right", hideOnMobile: true, render: (r) => money(r.unitPriceCents) },
              { key: "level", header: "Level", render: (r) => <StockBadge s={r.status} /> },
              { key: "updated", header: "Updated", sortable: true, hideOnMobile: true, render: (r) => fmtDateTime(r.updatedAt) },
              { key: "act", header: "", align: "right", render: (r) => <span className="inline-flex gap-1"><Button size="sm" variant="outline" onClick={() => setAdjust(r)}><SlidersHorizontal className="size-3.5" />Adjust</Button><Button size="sm" variant="ghost" aria-label={`History for ${r.name}`} onClick={() => api.get(`/api/inventory/${r.id}/movements`).then(setHistory).catch((e) => toast.error(e.message))}><History className="size-4" /></Button></span> },
            ]} />
        )}
        {list.data && <Pagination page={list.page} pageSize={list.data.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
      {adjust && <AdjustModal item={adjust} onClose={() => setAdjust(null)} onDone={() => { setAdjust(null); list.reload(); }} />}
      {adding && <AddModal merchants={merchants.data?.items ?? []} coordinator={coordinator} onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} />}
      <Drawer open={!!history} onOpenChange={(o) => !o && setHistory(null)} title={history?.item.name ?? ""} subtitle="Stock movement history">
        {history && <ul className="divide-y divide-line">{history.movements.map((m: any) => <li key={m.id} className="py-3 text-sm"><div className="flex justify-between"><span className={`font-semibold tabular ${m.delta < 0 ? "text-danger" : "text-success"}`}>{m.delta > 0 ? "+" : ""}{m.delta}</span><span className="text-muted">→ {m.quantityAfter} on hand</span></div><p className="text-xs text-muted">{m.reason.replace("_", " ")}{m.note ? ` · ${m.note}` : ""} · {m.actor ?? "System"} · {fmtDateTime(m.createdAt)}</p></li>)}{!history.movements.length && <li className="py-6 text-center text-sm text-muted">No movements recorded.</li>}</ul>}
      </Drawer>
    </div>
  );
}

function AdjustModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { register, handleSubmit, watch, setError, formState: { errors, isSubmitting } } = useForm<z.infer<typeof adjustSchema>>({ resolver: zodResolver(adjustSchema), defaultValues: { mode: "delta", value: undefined as unknown as number, reason: "restock", note: "" } });
  const mode = watch("mode"), value = watch("value");
  const preview = Number.isFinite(value) ? (mode === "set" ? value : item.quantity + value) : null;
  const submit = handleSubmit(async (v) => {
    try { await api.post(`/api/inventory/${item.id}/adjust`, { ...v, note: v.note || undefined }); toast.success(`${item.name} updated`); onDone(); }
    catch (e) { setError("root", { message: e instanceof Error ? e.message : "Could not adjust" }); }
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Adjust ${item.name}`} description={`Currently ${num(item.quantity)} ${item.unit} on hand.`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={isSubmitting} onClick={submit}>Save adjustment</Button></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-4"><Field label="Method" htmlFor="a-mode"><Select id="a-mode" {...register("mode")}><option value="delta">Add / remove</option><option value="set">Set exact count</option></Select></Field><Field label={mode === "set" ? "New quantity" : "Change (+/−)"} error={errors.value?.message} htmlFor="a-val"><Input id="a-val" type="number" {...register("value", { valueAsNumber: true })} /></Field></div>
        {preview !== null && <p className={`text-sm ${preview < 0 ? "font-medium text-danger" : "text-muted"}`}>{preview < 0 ? "Quantity cannot go below zero." : `New quantity: ${num(preview)} ${item.unit}`}</p>}
        <Field label="Reason" htmlFor="a-reason"><Select id="a-reason" {...register("reason")}><option value="restock">Restock</option><option value="adjustment">Adjustment</option><option value="correction">Count correction</option></Select></Field>
        <Field label="Note (optional)" htmlFor="a-note"><Textarea id="a-note" className="min-h-16" {...register("note")} /></Field>
        {errors.root && <p role="alert" className="text-sm font-medium text-danger">{errors.root.message}</p>}
      </form>
    </Modal>
  );
}

function AddModal({ merchants, coordinator, onClose, onDone }: { merchants: any[]; coordinator: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<z.infer<typeof addSchema>>({ resolver: zodResolver(addSchema), defaultValues: { merchantId: "", name: "", category: "drinking_water", quantity: 0, unit: "each", price: undefined as unknown as number, minThreshold: 10 } });
  const submit = handleSubmit(async (v) => {
    if (coordinator && !v.merchantId) { setError("merchantId", { message: "Select a merchant" }); return; }
    try { await api.post("/api/inventory", { merchantId: coordinator ? v.merchantId : undefined, name: v.name, category: v.category, quantity: v.quantity, unit: v.unit, unitPriceCents: Math.round(v.price * 100), minThreshold: v.minThreshold }); toast.success("Item added"); onDone(); }
    catch (e) { setError("root", { message: e instanceof Error ? e.message : "Could not add item" }); }
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} wide title="Add inventory item" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={isSubmitting} onClick={submit}>Add item</Button></>}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {coordinator && <div className="sm:col-span-2"><Field label="Merchant" error={errors.merchantId?.message} htmlFor="n-m"><Select id="n-m" {...register("merchantId")}><option value="">Select…</option>{merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field></div>}
        <div className="sm:col-span-2"><Field label="Item name" error={errors.name?.message} htmlFor="n-n"><Input id="n-n" {...register("name")} /></Field></div>
        <Field label="Category" htmlFor="n-c"><Select id="n-c" {...register("category")}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
        <Field label="Unit" error={errors.unit?.message} htmlFor="n-u"><Input id="n-u" {...register("unit")} /></Field>
        <Field label="Opening quantity" error={errors.quantity?.message} htmlFor="n-q"><Input id="n-q" type="number" {...register("quantity", { valueAsNumber: true })} /></Field>
        <Field label="Unit price (USD)" error={errors.price?.message} htmlFor="n-p"><Input id="n-p" type="number" step="0.01" {...register("price", { valueAsNumber: true })} /></Field>
        <Field label="Low-stock threshold" error={errors.minThreshold?.message} htmlFor="n-t"><Input id="n-t" type="number" {...register("minThreshold", { valueAsNumber: true })} /></Field>
        {errors.root && <p role="alert" className="text-sm font-medium text-danger sm:col-span-2">{errors.root.message}</p>}
      </form>
    </Modal>
  );
}
