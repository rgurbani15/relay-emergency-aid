import { Bot, FlaskConical } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, ErrorState, Notice, PageSkeleton } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtDateTime, pct } from "@/lib/utils";

const FIELD_LABEL: Record<string, string> = { community: "Community", category: "Category", delayedQuantity: "Delayed quantity", delayHours: "Delay (hours)", additionalResidents: "Additional residents", merchantClosure: "Merchant closure" };
const show = (v: unknown) => (v === null || v === undefined ? "—" : String(v));

/** Real, measured benchmark of the Workers AI interpreter on a synthetic dataset. Nothing here is hardcoded: with no stored run, no scores are shown. */
export function AiEvaluation({ programId }: { programId: string }) {
  const { data, loading, error, reload } = useApi<any>(`/api/intelligence/ai-eval?programId=${programId}`);
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error ?? "No data"} onRetry={reload} />;
  const run = data.latest;
  const m = run?.metrics;

  const start = async () => {
    setRunning(true); setRunErr(null);
    try { await api.post("/api/intelligence/ai-eval/run", { programId }); toast.success("Benchmark finished. Results below are measured from this run."); reload(); }
    catch (e) { setRunErr(e instanceof Error ? e.message : "Benchmark failed"); }
    finally { setRunning(false); }
  };

  const tiles = m ? [
    ["Field-level accuracy", pct(m.fieldAccuracy, 1), `${m.fieldsCorrect} of ${m.fieldsTotal} fields correct`],
    ["Invalid JSON rate", pct(m.invalidJsonRate, 1), `${m.invalidJsonCount} of ${m.evaluated} responses · schema-invalid ${m.schemaInvalidCount}`],
    ["Unsupported-value rate", pct(m.unsupportedValueRate, 1), `${m.unsupportedValues} of ${m.emittedValues} emitted values not supported by the report`],
    ["Missing-field rate", pct(m.missingFieldRate, 1), `${m.missingFields} of ${m.expectedFields} expected values left empty`],
    ["Latency (median / p95)", `${Math.round(m.latencyMs.p50)} / ${Math.round(m.latencyMs.p95)} ms`, `mean ${Math.round(m.latencyMs.mean)} ms · max ${Math.round(m.latencyMs.max)} ms`],
  ] : [];

  return (
    <div className="space-y-6">
      <div><p className="eyebrow">Section 05</p><h2 className="font-display mt-1 text-[28px] text-evergreen">Model evaluation</h2></div>
      <Notice tone="info"><p className="font-medium">Synthetic benchmark, measured results only</p><p className="mt-1">{data.disclosure}</p></Notice>

      <Card>
        <CardHeader title="AI scenario interpreter benchmark" subtitle={`${data.dataset.size} synthetic incident reports · dataset ${data.dataset.version}`} action={<Button onClick={start} loading={running} disabled={!data.aiAvailable}><Bot className="size-4" />{run ? "Re-run benchmark" : "Run benchmark"}</Button>} />
        <div className="space-y-3 p-5 text-sm text-muted">
          <p>Each report is sent to the same Workers AI interpreter used in the scenario simulator. Its output is compared with hand-written expected fields. The run takes about a minute because reports are sent one at a time so latency is measured fairly. It reads the program&apos;s community and merchant names only and never changes balances, vouchers, ledger entries, inventory or allocations.</p>
          {!data.aiAvailable && <Notice tone="warning">Workers AI is not available in this environment, so a new benchmark cannot run here. Start the app with <code className="rounded bg-ink/5 px-1">npm run dev:ai</code> (requires a Cloudflare login) or use the deployed Worker. RELAY never shows placeholder scores.</Notice>}
          {runErr && <Notice tone="danger">{runErr}</Notice>}
        </div>
      </Card>

      {!run && <Card><div className="p-8 text-center"><FlaskConical className="mx-auto size-6 text-muted" aria-hidden /><h3 className="mt-2 font-semibold text-navy">No measured results yet</h3><p className="mt-1 text-sm text-muted">Run the benchmark to measure the model on this dataset.</p></div></Card>}

      {run && m && (<>
        <p className="text-sm text-muted">Latest run {fmtDateTime(run.createdAt)} · model <code className="rounded bg-ink/5 px-1">{run.model}</code> · {m.evaluated} of {m.reports} reports answered{m.errored > 0 ? ` (${m.errored} call errors excluded)` : ""}</p>
        <Card className="overflow-hidden"><div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 xl:grid-cols-5">{tiles.map(([k, v, sub]) => <div key={k} className="bg-warm p-5"><p className="eyebrow">{k}</p><p className="font-display tabular mt-2 text-[30px] leading-none text-evergreen">{v}</p><p className="mt-2 text-xs leading-snug text-secondary">{sub}</p></div>)}</div></Card>

        <Card>
          <CardHeader title="Accuracy by field" subtitle="Correct = matches the expected value, including correctly leaving a field empty. Reports with unparseable output are excluded here and counted in the invalid-output rates." />
          <div className="scroll-thin overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm"><caption className="sr-only">Field-level accuracy</caption><thead className="bg-canvas text-xs uppercase tracking-wide text-muted"><tr><th scope="col" className="px-4 py-2 font-medium">Field</th><th scope="col" className="px-4 py-2 text-right font-medium">Correct</th><th scope="col" className="px-4 py-2 text-right font-medium">Accuracy</th></tr></thead>
            <tbody className="divide-y divide-line">{Object.entries(m.perField).map(([f, x]: [string, any]) => <tr key={f}><th scope="row" className="px-4 py-2 font-medium text-ink">{FIELD_LABEL[f] ?? f}</th><td className="tabular px-4 py-2 text-right">{x.correct}/{x.total}</td><td className="tabular px-4 py-2 text-right">{pct(x.accuracy, 0)}</td></tr>)}</tbody></table></div>
        </Card>

        <Card>
          <CardHeader title="Per-report results" subtitle="Expected versus what the model returned after grounding. Unsupported values are shown as missing." />
          <div className="divide-y divide-line">
            {run.results.map((r: any) => {
              const wrong = r.outcome === "ok" ? Object.keys(r.fieldCorrect).filter((f) => !r.fieldCorrect[f]) : [];
              return (
                <details key={r.id} className="px-5 py-3 text-sm">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2"><span className="font-mono text-xs text-muted">{r.id}</span><Badge tone="neutral">{r.tag}</Badge>
                    {r.outcome === "ok" ? <Badge tone={wrong.length ? "warning" : "success"}>{wrong.length ? `${wrong.length} field${wrong.length > 1 ? "s" : ""} wrong` : "All fields correct"}</Badge> : <Badge tone="danger">{r.outcome === "invalid_json" ? "Invalid JSON" : r.outcome === "schema_invalid" ? "Schema-invalid" : "Call error"}</Badge>}
                    {r.unsupported.length > 0 && <Badge tone="danger">{r.unsupported.length} unsupported</Badge>}<span className="ml-auto text-xs text-muted">{Math.round(r.latencyMs)} ms</span></summary>
                  <p className="mt-2 rounded-lg bg-canvas p-3 text-muted">“{r.text}”</p>
                  {r.actual && <div className="scroll-thin mt-2 overflow-x-auto"><table className="w-full min-w-[420px] text-left text-xs"><thead className="text-muted"><tr><th className="py-1 pr-3 font-medium">Field</th><th className="py-1 pr-3 font-medium">Expected</th><th className="py-1 pr-3 font-medium">Model</th><th className="py-1 font-medium" /></tr></thead><tbody>{Object.keys(FIELD_LABEL).map((f) => <tr key={f} className="border-t border-line"><td className="py-1 pr-3">{FIELD_LABEL[f]}</td><td className="py-1 pr-3">{show(r.expected[f])}</td><td className="py-1 pr-3">{show(r.emitted[f])}</td><td className="py-1">{r.fieldCorrect[f] ? "✓" : "✗"}</td></tr>)}</tbody></table></div>}
                </details>
              );
            })}
          </div>
        </Card>
      </>)}

      <details className="rounded-card border border-line bg-warm">
        <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold text-navy">Dataset and scoring method ({data.dataset.size} synthetic reports)</summary>
        <div className="space-y-3 border-t border-line px-5 py-4 text-sm text-muted">
          <p>Reports cover delayed shipments, merchant closures, population increases, inventory reductions, multiple communities, missing information, ambiguous quantities, unrelated numbers, an unknown community and an unknown merchant. Expected values were written by hand when the dataset was created.</p>
          <ul className="list-disc space-y-1 pl-5"><li><strong>Field-level accuracy:</strong> share of the six fields per parsed report that match the expected value.</li><li><strong>Invalid JSON rate:</strong> responses that could not be parsed as JSON (schema-invalid responses are reported alongside).</li><li><strong>Unsupported-value rate:</strong> emitted values that do not appear in the report text or do not match a known community, merchant or category.</li><li><strong>Missing-field rate:</strong> expected values the model left empty.</li><li><strong>Latency:</strong> wall-clock time per model call, measured in the Worker.</li></ul>
          <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg bg-canvas p-3 text-xs">{data.dataset.reports.map((r: any) => <li key={r.id}><span className="font-mono">{r.id}</span> <span className="text-ink">[{r.tag}]</span> {r.text}</li>)}</ul>
        </div>
      </details>
    </div>
  );
}
