import { Download, FileText } from "lucide-react";
import { useState } from "react";
import { Button, Card, CardHeader, DataTable, ErrorState, Notice, PageHeader, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useProgram } from "@/lib/program";
import { useToast } from "@/lib/toast";
import { cn, downloadFile } from "@/lib/utils";

export default function Reports() {
  const { programId } = useProgram();
  const list = useApi<{ reports: { id: string; title: string }[] }>("/api/reports");
  const [type, setType] = useState("budget_usage");
  const rep = useApi<any>(programId ? `/api/reports/${type}?programId=${programId}` : null);
  const toast = useToast();
  const csv = async () => { const r = await fetch(`/api/reports/${type}?programId=${programId}&format=csv`, { credentials: "same-origin" }); if (!r.ok) return toast.error("Export failed"); downloadFile(`relay-${type}.csv`, await r.text()); toast.success("Report downloaded"); };
  return (
    <div>
      <PageHeader title="Reports" subtitle="Export-ready summaries for the selected program." actions={<Button onClick={csv} disabled={!rep.data}><Download className="size-4" />Download CSV</Button>} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)] [&>*]:min-w-0">
        <nav aria-label="Reports" className="space-y-1 border-border lg:border-r lg:pr-4">{list.loading ? <><Skeleton className="h-10" /><Skeleton className="h-10" /></> : list.data?.reports.map((r) => <button key={r.id} onClick={() => setType(r.id)} aria-current={type === r.id} className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium", type === r.id ? "bg-navy text-white" : "text-ink hover:bg-warm")}><FileText className="size-4 shrink-0" />{r.title}</button>)}</nav>
        <Card>
          <CardHeader title={rep.data?.title ?? "Report"} subtitle="Amounts in US dollars. Synthetic data." />
          {rep.error ? <div className="p-5"><ErrorState error={rep.error} onRetry={rep.reload} /></div> : (<>
            {rep.data?.note && <div className="px-5 pt-4"><Notice tone="info">{rep.data.note}</Notice></div>}
            <DataTable loading={rep.loading} rows={rep.data?.rows.slice(0, 100).map((r: any[], i: number) => ({ i, r }))} rowKey={(x: any) => String(x.i)} caption={rep.data?.title}
              columns={(rep.data?.columns ?? []).map((c: string, i: number) => ({ key: String(i), header: c, render: (x: any) => String(x.r[i] ?? "—"), align: /\(USD\)|%|Samples|MAE|Change|Quantity|Redemptions/.test(c) ? ("right" as const) : undefined }))} />
            {rep.data && rep.data.rows.length > 100 && <p className="border-t border-line px-5 py-3 text-xs text-muted">Showing the first 100 of {rep.data.rows.length} rows. Download the CSV for the full report.</p>}
          </>)}
        </Card>
      </div>
    </div>
  );
}
