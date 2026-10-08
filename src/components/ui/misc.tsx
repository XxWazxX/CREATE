import type { LucideIcon } from "lucide-react";
import type { Tag } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TagPill({
  tag,
  className,
  onRemove,
}: {
  tag: Pick<Tag, "name" | "color">;
  className?: string;
  onRemove?: () => void;
}) {
  return (
    <span
      className={cn(
        "border-line-strong text-muted inline-flex h-5 max-w-36 items-center gap-1 rounded-full border px-2 text-[11px] whitespace-nowrap",
        className,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: tag.color ?? "var(--muted)" }} />
      <span className="truncate">{tag.name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="text-faint hover:text-fg -mr-1 ml-0.5"
          aria-label={`Retirer ${tag.name}`}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-20 text-center", className)}>
      <div className="border-line bg-raised text-muted mb-4 grid size-12 place-items-center rounded-2xl border">
        <Icon className="size-5" />
      </div>
      <h3 className="text-[15px] font-medium">{title}</h3>
      {children ? <p className="text-muted mt-1 max-w-sm text-[13px]">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3 px-4 pt-6 pb-4 md:px-8 md:pt-8", className)}>
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-muted mt-0.5 text-[13px]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PlayingBars({ className, paused }: { className?: string; paused?: boolean }) {
  return (
    <span className={cn("inline-flex h-3.5 items-end gap-[2px]", className)} aria-label="En lecture">
      {[0, 0.2, 0.4].map((d) => (
        <span
          key={d}
          className="eq-bar bg-accent w-[3px] rounded-[1px]"
          style={{ height: "100%", animationDelay: `${d}s`, animationPlayState: paused ? "paused" : "running" }}
        />
      ))}
    </span>
  );
}
