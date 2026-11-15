import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X } from "lucide-react";
import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn, titleCase } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { useLocation } from "react-router-dom";

const SECTION_LABEL: Record<string, string> = { overview: "Workspace", programs: "Aid operations", communities: "Aid operations", residents: "Aid operations", merchants: "Market network", inventory: "Market network", transactions: "Market network", intelligence: "Intelligence", allocations: "Intelligence", reconciliation: "Financials", reports: "Financials", audit: "Administration", settings: "Administration" };

/* ---------- Buttons ---------- */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
const variants: Record<Variant, string> = {
  primary: "bg-evergreen text-warm hover:bg-forest",
  secondary: "bg-softsage text-evergreen hover:bg-[#d9e2d4]",
  outline: "border border-border-strong bg-warm text-ink hover:bg-softneutral",
  ghost: "text-ink hover:bg-ink/5",
  danger: "bg-danger text-warm hover:bg-[#a5433c]",
};
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...p }, ref) => (
    <button ref={ref} disabled={disabled || loading} className={cn("inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50", size === "sm" ? "h-8 px-3 text-xs" : size === "lg" ? "h-11 px-6 text-[15px]" : "h-10 px-4 text-sm", variants[variant], className)} {...p}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

/* ---------- Form controls ---------- */
const control = "w-full rounded-md border border-border-strong bg-warm px-3 text-sm text-ink placeholder:text-mutedtext transition-colors focus:border-evergreen focus:outline-none focus:ring-1 focus:ring-evergreen disabled:bg-canvas disabled:text-muted aria-[invalid=true]:border-danger";
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(control, "h-10", className)} {...p} />);
Input.displayName = "Input";
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(control, "min-h-24 py-2", className)} {...p} />);
Textarea.displayName = "Textarea";
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(control, "h-10 pr-8", className)} {...p} />);
Select.displayName = "Select";

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="pl-9" />
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options, className }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string }) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cn("w-auto min-w-36", className)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}

/* ---------- Cards & status ---------- */
export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-line bg-card", className)} {...p}>{children}</div>;
}
export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0"><h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3>{subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}</div>
      {action}
    </div>
  );
}

const tones = {
  success: "bg-success-soft text-success", warning: "bg-warning-soft text-[#8a5f1a]", danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info", neutral: "bg-softneutral text-muted", teal: "bg-softsage text-evergreen",
};
export type Tone = keyof typeof tones;
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}
const STATUS_TONE: Record<string, Tone> = {
  active: "success", open: "success", healthy: "success", approved: "success", completed: "success", low: "warning", limited: "warning", pending: "warning", pending_approval: "warning", elevated: "warning", paused: "warning", draft: "neutral",
  critical: "danger", high: "danger", closed: "neutral", out_of_stock: "danger", rejected: "danger", reversed: "danger", cancelled: "danger", suspended: "danger", expired: "neutral", exhausted: "neutral", superseded: "neutral", inactive: "neutral",
  info: "info", vouchers: "success", mixed: "info", direct_supply: "warning",
};
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const map: Record<string, string> = { out_of_stock: "Out of stock", pending_approval: "Pending approval", direct_supply: "Direct supply" };
  const tone = STATUS_TONE[status] ?? "neutral";
  const dot = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info", neutral: "bg-mutedtext", teal: "bg-forest" }[tone];
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-ink"><span className={cn("size-2 rounded-full", dot)} aria-hidden />{label ?? map[status] ?? titleCase(status)}</span>;
}

export function ProgressBar({ value, tone = "teal", className }: { value: number; tone?: "teal" | "warning" | "danger" | "info"; className?: string }) {
  const color = { teal: "bg-forest", warning: "bg-warning", danger: "bg-danger", info: "bg-info" }[tone];
  return <div className={cn("h-1.5 w-full overflow-hidden rounded-sm bg-softneutral", className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}><div className={cn("h-full rounded-sm transition-all", color)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>;
}

/* ---------- Loading / empty / error ---------- */
export const Skeleton = ({ className }: { className?: string }) => <div className={cn("skeleton", className)} aria-hidden />;
export function PageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: cards }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      <Skeleton className="h-72" />
    </div>
  );
}
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return <div className="space-y-2 p-5" aria-busy="true">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>;
}
export function EmptyState({ title, message, action, icon }: { title: string; message?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-lg bg-softneutral text-muted">{icon ?? <Inbox className="size-5" />}</div>
      <p className="font-semibold text-ink">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: ApiError | Error | string; onRetry?: () => void }) {
  const msg = typeof error === "string" ? error : error.message;
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-card border border-danger/30 bg-danger-soft px-6 py-10 text-center">
      <AlertTriangle className="mb-2 size-6 text-danger" />
      <p className="font-semibold text-ink">Something went wrong</p>
      <p className="mt-1 max-w-md text-sm text-muted">{msg}</p>
      {onRetry && <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
export const Notice = ({ tone = "info", children, className }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode; className?: string }) => (
  <div role={tone === "danger" ? "alert" : "note"} className={cn("rounded-lg border px-4 py-3 text-sm", { info: "border-info/30 bg-info-soft text-[#2f5560]", warning: "border-warning/40 bg-warning-soft text-[#6f4a12]", danger: "border-danger/40 bg-danger-soft text-[#8a3630]", success: "border-success/30 bg-success-soft text-[#2a5e44]" }[tone], className)}>{children}</div>
);

/* ---------- Page chrome ---------- */
export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  const seg = useLocation().pathname.split("/")[2] ?? "";
  eyebrow ??= SECTION_LABEL[seg] ? `${SECTION_LABEL[seg]} / ${title}` : undefined;
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
      <div className="min-w-0">{eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}<h1 className="font-display text-[32px] font-medium leading-tight text-evergreen sm:text-[36px]">{title}</h1>{subtitle && <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
export function MetricCard({ label, value, sub, trend, icon, tone }: { label: string; value: ReactNode; sub?: ReactNode; trend?: { label: string; dir: "up" | "down" | "flat"; good?: boolean }; icon?: ReactNode; tone?: Tone }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow">{label}</p>
        {icon && <span className={cn("grid size-7 place-items-center rounded-md", tone ? tones[tone] : "bg-softsage text-evergreen")}>{icon}</span>}
      </div>
      <p className="tabular mt-2 text-[28px] font-medium leading-none tracking-tight text-evergreen">{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
        {trend && <span className={cn("inline-flex items-center gap-0.5 font-medium", trend.dir === "flat" ? "text-muted" : trend.good === false ? "text-danger" : "text-success")}>{trend.dir === "up" ? <ArrowUp className="size-3" /> : trend.dir === "down" ? <ArrowDown className="size-3" /> : null}{trend.label}</span>}
        {sub && <span>{sub}</span>}
      </div>
    </Card>
  );
}

/* ---------- Table ---------- */
export interface Column<T> { key: string; header: string; render: (row: T) => ReactNode; sortable?: boolean; align?: "right" | "left"; className?: string; hideOnMobile?: boolean }
export function DataTable<T>({ columns, rows, rowKey, onRowClick, sort, onSort, empty, loading, caption, rowClass }: {
  rowClass?: (r: T) => string | undefined;
  columns: Column<T>[]; rows: T[] | undefined; rowKey: (r: T) => string; onRowClick?: (r: T) => void;
  sort?: { key: string; dir: "asc" | "desc" }; onSort?: (key: string) => void; empty?: ReactNode; loading?: boolean; caption?: string;
}) {
  if (loading) return <TableSkeleton />;
  if (!rows?.length) return <>{empty ?? <EmptyState title="Nothing to show" message="No records match the current filters." />}</>;
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13.5px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-border-strong text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-secondary">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("px-4 py-3", c.align === "right" && "text-right", c.hideOnMobile && "hidden md:table-cell", c.className)} aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                {c.sortable && onSort ? (
                  <button className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink" onClick={() => onSort(c.key)}>
                    {c.header}{sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                  </button>
                ) : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className={cn("border-b border-line last:border-0", rowClass?.(r), onRowClick && "cursor-pointer hover:bg-softneutral/60 focus-within:bg-softneutral/60")} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c, i) => (
                <td key={c.key} className={cn("px-4 py-3 align-middle", c.align === "right" && "tabular text-right", c.hideOnMobile && "hidden md:table-cell", c.className)}>
                  {onRowClick && i === 0 ? <button className="text-left font-medium text-ink focus:outline-none focus-visible:underline" onClick={(e) => { e.stopPropagation(); onRowClick(r); }}>{c.render(r)}</button> : c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <p className="px-5 py-3 text-xs text-muted">{total} {total === 1 ? "record" : "records"}</p> : null;
  const from = (page - 1) * pageSize + 1, to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
      <span>Showing {from}–{to} of {total}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
        <span className="px-2">Page {page} of {pages}</span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
      </div>
    </div>
  );
}
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="scroll-thin flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)} className={cn("whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors", value === t.value ? "border-evergreen text-evergreen" : "border-transparent text-muted hover:text-ink")}>{t.label}</button>
      ))}
    </div>
  );
}
export function Segmented<T extends string | number>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-border-strong bg-warm p-0.5">
      {options.map((o) => <button key={String(o.value)} aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={cn("rounded px-3 py-1.5 text-xs font-medium transition-colors", value === o.value ? "bg-evergreen text-warm" : "text-muted hover:text-ink")}>{o.label}</button>)}
    </div>
  );
}

/* ---------- Dialogs ---------- */
export function Modal({ open, onOpenChange, title, description, children, footer, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-evergreen/50" />
        <Dialog.Content className={cn("pop-in fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-warm shadow-pop", wide ? "max-w-2xl" : "max-w-md")}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div><Dialog.Title className="font-display text-xl font-medium text-evergreen">{title}</Dialog.Title>{description ? <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}</div>
            <Dialog.Close className="rounded-md p-1 text-muted hover:bg-ink/5 hover:text-ink" aria-label="Close"><X className="size-5" /></Dialog.Close>
          </div>
          <div className="scroll-thin overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-canvas px-6 py-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", danger, requireReason, onConfirm, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; confirmLabel?: string; danger?: boolean; requireReason?: string;
  onConfirm: (reason: string) => Promise<void> | void; children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setReason(""); setErr(null); setBusy(false); } }, [open]);
  const submit = async () => {
    if (requireReason && reason.trim().length < 3) { setErr("A reason of at least 3 characters is required."); return; }
    setBusy(true); setErr(null);
    try { await onConfirm(reason.trim()); onOpenChange(false); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button><Button variant={danger ? "danger" : "primary"} loading={busy} onClick={submit}>{confirmLabel}</Button></>}>
      <div className="space-y-4">
        {children}
        {requireReason && <Field label={requireReason} htmlFor="reason"><Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>}
        {err && <p role="alert" className="text-sm font-medium text-danger">{err}</p>}
      </div>
    </Modal>
  );
}
export function Drawer({ open, onOpenChange, title, subtitle, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-evergreen/40" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-warm shadow-pop">
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div><Dialog.Title className="font-display text-xl font-medium text-evergreen">{title}</Dialog.Title>{subtitle ? <Dialog.Description className="mt-0.5 text-sm text-muted">{subtitle}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}</div>
            <Dialog.Close className="rounded-md p-1 text-muted hover:bg-ink/5" aria-label="Close"><X className="size-5" /></Dialog.Close>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export const DL = ({ items }: { items: [string, ReactNode][] }) => (
  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">{items.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="text-right font-medium text-ink">{v}</dd></div>)}</dl>
);


/** Numbered editorial section used on detail pages: "01 Title" over a thin rule. */
export function Section({ n, title, aside, children, id }: { n: string; title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  const hid = id ?? `sec-${n}`;
  return (
    <section aria-labelledby={hid} className="mt-10 first:mt-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-t border-border-strong pt-4">
        <div className="flex items-baseline gap-3"><span className="tabular text-[13px] font-medium text-moss">{n}</span><h2 id={hid} className="font-display text-[24px] leading-tight text-evergreen">{title}</h2></div>
        {aside}
      </div>
      {children}
    </section>
  );
}
