import { Activity, Bell, ChevronDown, Boxes, Building2, ClipboardList, FileBarChart, Gauge, Home, LogOut, Menu, Receipt, ScrollText, Settings, Store, Users, Wallet, X } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { DemoBanner, Wordmark } from "@/components/brand";
import { Select } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { ChatPanel } from "@/components/ChatPanel";
import { useProgram } from "@/lib/program";
import { cn } from "@/lib/utils";

const NAV_GROUPS = [
  { heading: "Workspace", items: [{ to: "/app/overview", label: "Overview", icon: Gauge }] },
  { heading: "Aid operations", items: [
    { to: "/app/programs", label: "Relief Programs", icon: ClipboardList },
    { to: "/app/communities", label: "Communities", icon: Home },
    { to: "/app/residents", label: "Residents", icon: Users },
  ] },
  { heading: "Market network", items: [
    { to: "/app/merchants", label: "Merchants", icon: Store },
    { to: "/app/inventory", label: "Inventory", icon: Boxes },
    { to: "/app/transactions", label: "Transactions", icon: Receipt },
  ] },
  { heading: "Intelligence", items: [
    { to: "/app/intelligence", label: "RELAY Intelligence", icon: Activity },
    { to: "/app/allocations", label: "Allocations", icon: Wallet },
  ] },
  { heading: "Financials", items: [
    { to: "/app/reconciliation", label: "Reconciliation", icon: Building2 },
    { to: "/app/reports", label: "Reports", icon: FileBarChart },
  ] },
  { heading: "Administration", items: [
    { to: "/app/audit", label: "Audit Log", icon: ScrollText },
    { to: "/app/settings", label: "Settings", icon: Settings },
  ] },
];

const TITLES: Record<string, string> = { overview: "Overview", programs: "Relief Programs", communities: "Communities", residents: "Residents", merchants: "Merchants", inventory: "Inventory", transactions: "Transactions", intelligence: "RELAY Intelligence", allocations: "Allocations", reconciliation: "Reconciliation", reports: "Reports", audit: "Audit Log", settings: "Settings" };
const GROUP_OF: Record<string, string> = Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.to.split("/")[2], g.heading])));

export default function CoordinatorLayout() {
  const { user, signOut } = useAuth();
  const { programs, program, setProgramId } = useProgram();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  if (user && user.role !== "coordinator") return <Navigate to="/" replace />;
  const seg = loc.pathname.split("/")[2] ?? "overview";
  const initials = (user?.name ?? "").split(" ").map((x) => x[0]).slice(0, 2).join("");
  const leave = async () => { await signOut(); nav("/"); };

  const sidebar = (
    <nav aria-label="Primary" className="flex h-full w-[245px] flex-col bg-sidebar text-sidebar-muted">
      <div className="flex h-[68px] items-center justify-between px-5"><Wordmark light descriptor /><button className="rounded p-1 text-sidebar-muted hover:text-warm lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button></div>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-3">
        {NAV_GROUPS.map((g) => (
          <div key={g.heading} role="group" aria-labelledby={`nav-${g.heading}`}>
            <p id={`nav-${g.heading}`} className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-moss">{g.heading}</p>
            <ul className="space-y-px">
              {g.items.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink to={to} onClick={() => setOpen(false)} className={({ isActive }) => cn("relative flex items-center gap-3 rounded-md px-3 py-[7px] text-[13.5px] font-medium transition-colors", isActive ? "bg-sidebar-active text-warm" : "hover:bg-sidebar-active/50 hover:text-warm")}>
                    {({ isActive }) => (<>{isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-sage" aria-hidden />}<Icon className={cn("size-[17px]", isActive ? "text-warm" : "text-moss")} aria-hidden />{label}</>)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="relative border-t border-warm/10 p-3">
        {menu && (
          <div role="menu" className="pop-in absolute inset-x-3 bottom-full mb-1 rounded-md border border-warm/15 bg-evergreen p-1 shadow-pop">
            <Link role="menuitem" to="/app/settings" onClick={() => { setMenu(false); setOpen(false); }} className="flex items-center gap-2 rounded px-3 py-2 text-[13px] text-warm hover:bg-sidebar-active"><Settings className="size-4" />Profile and settings</Link>
            <button role="menuitem" onClick={leave} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-[13px] text-warm hover:bg-sidebar-active"><LogOut className="size-4" />Sign out</button>
          </div>
        )}
        <button onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-sidebar-active/50">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-sage text-xs font-semibold text-evergreen">{initials}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-warm">{user?.name}</span><span className="block truncate text-[11px] text-sidebar-muted">Relief coordinator</span></span>
          <ChevronDown className="size-4 text-moss" aria-hidden />
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <div className="flex flex-1">
        <aside className="no-print sticky top-0 hidden h-dvh w-[245px] shrink-0 lg:block">{sidebar}</aside>
        {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-evergreen/60" onClick={() => setOpen(false)} /><div className="absolute inset-y-0 left-0">{sidebar}</div></div>}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-warm px-4 sm:px-8">
            <button className="rounded-md p-2 text-ink hover:bg-ink/5 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-[13px] text-secondary md:flex"><span className="truncate">{GROUP_OF[seg] ?? "Workspace"}</span><span aria-hidden>/</span><span className="truncate font-medium text-ink" aria-current="page">{TITLES[seg] ?? "RELAY"}</span></nav>
            <div className="ml-auto flex min-w-0 items-center gap-2">
              <label htmlFor="program-select" className="sr-only">Active program</label>
              <Select id="program-select" value={program?.id ?? ""} onChange={(e) => setProgramId(e.target.value)} className="h-9 max-w-[15rem] truncate text-[13px] font-medium" disabled={!programs.length}>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status !== "active" ? ` (${p.status})` : ""}</option>)}
                {!programs.length && <option>No programs</option>}
              </Select>
              <Link to="/app/overview#alerts" className="grid size-9 shrink-0 place-items-center rounded-md border border-border-strong text-ink hover:bg-softneutral" aria-label="View alerts"><Bell className="size-4" /></Link>
            </div>
          </header>
          <main id="main" className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-8 sm:px-8 lg:px-9" key={seg}><Outlet /></main>
          <ChatPanel role="coordinator" programId={program?.id} />
        </div>
      </div>
    </div>
  );
}
