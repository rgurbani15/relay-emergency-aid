import { ArrowRight, Home, Shield, Store, User as UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Wordmark } from "@/components/brand";
import { ErrorState, Skeleton, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { homeFor, useAuth, type User } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface Account { id: string; role: User["role"]; name: string; subtitle: string }
const ROLE_META = {
  coordinator: { title: "Relief coordinator", blurb: "Programs, market-aware allocation, reconciliation and reports.", icon: Shield },
  merchant: { title: "Merchant", blurb: "POS terminal, inventory, sales and reimbursement claims.", icon: Store },
  resident: { title: "Resident", blurb: "Your balance, QR vouchers and participating stores.", icon: UserIcon },
} as const;

export default function SignIn() {
  const { user, ready, signIn, demoMode } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { api.get("/api/auth/demo-accounts").then((r) => setAccounts(r.accounts)).catch((e) => setError(e.message)); }, []);
  if (ready && user) return <Navigate to={homeFor(user.role)} replace />;

  const go = async (a: Account) => {
    setBusy(a.id);
    try { const u = await signIn(a.role, a.id); nav(homeFor(u.role)); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not sign in"); setBusy(null); }
  };
  const groups = (["coordinator", "merchant", "resident"] as const).map((role) => ({ role, items: (accounts ?? []).filter((a) => a.role === role) }));

  return (
    <div className="min-h-dvh bg-paper">
      <aside className="bg-evergreen px-6 py-8 text-warm sm:px-12">
       <div className="mx-auto max-w-6xl">
        <Link to="/" aria-label="RELAY home"><Wordmark light descriptor /></Link>
        <div className="mt-10 max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sage">Emergency aid / Market intelligence</p>
          <h1 className="font-display mt-3 text-[30px] leading-tight sm:text-[36px]">Assistance should reach people where it can make a difference.</h1>
          <p className="mt-5 leading-relaxed text-sidebar-muted">RELAY recommends how much aid should arrive as vouchers and how much as direct supply, based on what each local market can actually provide. People review and approve every recommendation.</p>
        </div>
        <p className="mt-8 text-xs text-sidebar-muted">Demonstration environment. Synthetic data; no real money, banks or personal information.</p>
       </div>
      </aside>

      <main id="main" className="px-6 py-10 sm:px-12 lg:py-12">
        <div className="mx-auto max-w-6xl">
          <p className="eyebrow">Demo access</p>
          <h2 className="font-display mt-2 text-[26px] text-evergreen">Choose a demo account</h2>
          <p className="mt-2 max-w-3xl text-[15px] text-muted">RELAY&apos;s sign-in is demo-only. Every account below is synthetic, and each role sees only what that role is permitted to see; permissions are enforced on the server, not just hidden in the interface.</p>
          {!demoMode && <Notice tone="warning" className="mt-4">Demo mode is disabled for this deployment.</Notice>}
          {error && <div className="mt-6"><ErrorState error={error} onRetry={() => location.reload()} /></div>}
          <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-9 md:grid-cols-3">
            {groups.map(({ role, items }) => {
              const m = ROLE_META[role]; const Icon = m.icon;
              return (
                <section key={role} aria-labelledby={`h-${role}`}>
                  <div className="flex items-start gap-3 border-b border-border-strong pb-3"><Icon className="mt-0.5 size-[18px] text-forest" aria-hidden /><div><h3 id={`h-${role}`} className="text-[15px] font-semibold text-ink">{m.title}</h3><p className="text-[13px] text-secondary">{m.blurb}</p></div></div>
                  <ul className="divide-y divide-line">
                    {!accounts && !error && <li className="space-y-2 py-3"><Skeleton className="h-10" /></li>}
                    {items.map((a) => (
                      <li key={a.id}>
                        <button disabled={!!busy} onClick={() => go(a)} className={cn("group flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-softneutral/60", busy && busy !== a.id && "opacity-50")}>
                          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-softsage text-[13px] font-semibold text-evergreen">{a.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{a.name}</span><span className="block truncate text-xs text-secondary">{busy === a.id ? "Signing in…" : a.subtitle}</span></span>
                          <ArrowRight className="size-4 text-moss opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          <p className="mt-10 flex items-center gap-2 text-xs text-secondary"><Home className="size-3.5" aria-hidden />Sessions use HttpOnly cookies and expire after 8 hours.</p>
        </div>
      </main>
    </div>
  );
}
