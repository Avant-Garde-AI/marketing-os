/**
 * Console primitives (spec 13 §6) — the 8 pieces every screen composes from.
 * Server-safe: no hooks. Instrument register by default; editorial only in
 * EmptyState and MomentBand.
 */

import { cn } from "@/lib/utils";

/* ─── Eyebrow: the one surviving tracked-uppercase + rule-draw ───── */
export function Eyebrow({ children, draw = false }: { children: React.ReactNode; draw?: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <span className={cn("rule", draw && "rule-draw")} />
      <span className="eyebrow">{children}</span>
    </div>
  );
}

/* ─── PageHeader: eyebrow → Playfair 28-30px → one-line sub ─────── */
export function PageHeader({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: React.ReactNode;
  sub?: string;
}) {
  return (
    <header className="animate-enter mb-8">
      <div className="mb-4">
        <Eyebrow draw>{eyebrow}</Eyebrow>
      </div>
      <h1 className="text-[28px] md:text-[30px]">{title}</h1>
      {sub && <p className="mt-2 max-w-xl text-[15px] text-ink-2">{sub}</p>}
    </header>
  );
}

/* ─── StatTile: label / Lora-tabular numeral / hairline / footnote ─ */
export function StatTile({
  label,
  value,
  note,
  loading = false,
}: {
  label: string;
  value: string | number | null;
  note?: string;
  loading?: boolean;
}) {
  return (
    <div className="group border border-hairline bg-raised p-5 transition-shadow duration-[160ms] hover:bar-active hover:shadow-card">
      <div className="mb-3 text-xs font-medium uppercase tracking-[0.1em] text-ink-3">{label}</div>
      {loading ? (
        <div className="skeleton mb-2 h-8 w-16" />
      ) : (
        <div className="tnum mb-1 text-[28px] leading-none">
          {value === null || value === undefined ? "—" : value}
        </div>
      )}
      <div className="border-t border-hairline pt-2 text-xs text-ink-3">{note ?? " "}</div>
    </div>
  );
}

/* ─── Chip: status without traffic lights (wording + fill) ───────── */
export function Chip({
  children,
  variant = "outline",
}: {
  children: React.ReactNode;
  variant?: "filled" | "outline" | "attention";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 text-xs font-medium",
        variant === "filled" && "bg-inverse text-paper",
        variant === "outline" && "border border-hairline-strong text-ink-2",
        variant === "attention" && "border-b border-gold text-ink",
      )}
    >
      {children}
    </span>
  );
}

/* ─── SectionCard: quiet raised panel with a Lora-500 head ───────── */
export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border border-hairline bg-raised", className)}>
      <div className="flex items-baseline justify-between border-b border-hairline px-5 py-3.5">
        <h2 className="font-body text-[15px] font-medium tracking-normal">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/* ─── EmptyState: the editorial moment (Playfair + italic) ───────── */
export function EmptyState({
  headline,
  sub,
  action,
}: {
  headline: React.ReactNode;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <div className="mb-5 flex items-center justify-center gap-4">
        <span className="rule" />
      </div>
      <p className="mx-auto max-w-md font-display text-[22px] leading-snug">{headline}</p>
      {sub && <p className="mx-auto mt-3 max-w-sm text-sm text-ink-2">{sub}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/* ─── MomentBand: the navy ritual surface (approve, manifesto) ───── */
export function MomentBand({
  eyebrow,
  children,
  signoff = true,
  className,
}: {
  eyebrow?: string;
  children: React.ReactNode;
  signoff?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("animate-band-up bg-inverse px-8 py-10 text-paper", className)}>
      {eyebrow && (
        <div className="mb-5 flex items-center gap-4">
          <span className="rule" />
          <span className="eyebrow">{eyebrow}</span>
        </div>
      )}
      <div className="font-display text-2xl leading-snug">{children}</div>
      {signoff && <div className="mt-6 font-script text-2xl text-paper-2">Avant-Garde.</div>}
    </div>
  );
}

/* ─── Buttons: the only two variants + arrow-link (spec §6) ──────── */
export function PrimaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 bg-inverse px-5 py-2.5 text-[14px] font-medium text-paper transition-opacity duration-[160ms] hover:opacity-90 disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function OutlineButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 border border-hairline-strong bg-transparent px-5 py-2.5 text-[14px] font-medium text-ink transition-colors duration-[160ms] hover:border-gold hover:text-gold disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}
