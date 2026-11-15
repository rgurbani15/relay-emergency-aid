import { Download } from "lucide-react";
import { useState } from "react";
import { ReceiptView } from "@/components/domain";
import { Button, Card, DataTable, Drawer, ErrorState, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { downloadFile, fmtDateTime, money } from "@/lib/utils";

export default function Sales() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<any>(`/api/merchant/sales?page=${page}&pageSize=12`);
  const [sel, setSel] = useState<any>(null);
  const toast = useToast();
  const open = (r: any) => api.get(`/api/merchant/sales/${r.id}`).then((x) => setSel(x.receipt)).catch((e) => toast.error(e.message));
  const csv = async () => { const r = await fetch("/api/merchant/sales?format=csv", { credentials: "same-origin" }); if (!r.ok) return toast.error("Export failed"); downloadFile("relay-sales-history.csv", await r.text()); };
  return (
    <div>
      <PageHeader title="Sales history" subtitle="Every voucher redemption at your business." actions={<Button variant="outline" onClick={csv}><Download className="size-4" />Export CSV</Button>} />
      <Card>
        {error ? <div className="p-5"><ErrorState error={error} onRetry={reload} /></div> : (
          <DataTable loading={loading} rows={data?.items} rowKey={(r: any) => r.id} onRowClick={open} caption="Sales" columns={[
            { key: "r", header: "Receipt", render: (r: any) => <span>{r.receiptNo}<span className="block text-xs font-normal text-muted">{fmtDateTime(r.createdAt)}</span></span> },
            { key: "v", header: "Voucher", hideOnMobile: true, render: (r: any) => <span className="font-mono text-xs">{r.voucherCode}</span> },
            { key: "l", header: "Lines", align: "right", hideOnMobile: true, render: (r: any) => r.lines },
            { key: "a", header: "Amount", align: "right", render: (r: any) => money(r.amountCents) },
            { key: "s", header: "Status", render: (r: any) => <StatusBadge status={r.status} /> },
          ]} />
        )}
        {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      <Drawer open={!!sel} onOpenChange={(o) => !o && setSel(null)} title="Receipt" subtitle={sel?.receiptNo}>{sel && <ReceiptView r={sel} printable />}</Drawer>
    </div>
  );
}
