import { cn } from "@/lib/utils";

/** RELAY symbol: three communities joined by a shared supply node. Solid evergreen, warm white and sage only. */
export function LogoMark({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  const bg = tone === "dark" ? "#193D35" : "#FFFDF8";
  const fg = tone === "dark" ? "#FFFDF8" : "#193D35";
  const hub = tone === "dark" ? "#879B83" : "#285B4B";
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="7" fill={bg} />
      <g stroke={fg} strokeWidth="1.8" strokeLinecap="round">
        <path d="M16 8.5 8.5 22.5M16 8.5l7.5 14M8.5 22.5h15" fill="none" />
        <path d="M16 8.5V17M8.5 22.5 16 17m7.5 5.5L16 17" fill="none" opacity=".55" />
      </g>
      <circle cx="16" cy="8.5" r="2.6" fill={fg} />
      <circle cx="8.5" cy="22.5" r="2.6" fill={fg} />
      <circle cx="23.5" cy="22.5" r="2.6" fill={fg} />
      <circle cx="16" cy="17" r="2.2" fill={hub} />
    </svg>
  );
}

export function Wordmark({ light, className, descriptor }: { light?: boolean; className?: string; descriptor?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark tone={light ? "light" : "dark"} />
      <span className="flex flex-col leading-none">
        <span className={cn("text-[17px] font-bold tracking-[0.18em]", light ? "text-warm" : "text-evergreen")}>RELAY</span>
        {descriptor && <span className={cn("mt-1 text-[9px] font-semibold uppercase tracking-[0.16em]", light ? "text-sidebar-muted" : "text-secondary")}>Emergency aid network</span>}
      </span>
    </span>
  );
}

export const DemoBanner = () => (
  <div className="no-print bg-evergreen px-4 py-1.5 text-center text-xs text-sidebar-muted">Demonstration environment · synthetic data · no real money, banks or personal information</div>
);
