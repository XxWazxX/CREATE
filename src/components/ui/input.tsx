import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-lg border border-line bg-raised px-3 text-[13px] text-fg placeholder:text-faint outline-none transition-colors focus:border-line-strong focus:bg-hover disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(base, "h-9", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(base, "min-h-24 resize-y py-2 leading-relaxed", className)} {...props} />;
});

export function Label({
  children,
  className,
  htmlFor,
}: {
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("text-muted mb-1.5 block text-xs font-medium", className)}>
      {children}
    </label>
  );
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-faint mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 select-none",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <span
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors",
          checked ? "border-accent bg-accent text-accent-fg" : "border-line-strong bg-raised",
        )}
      >
        {checked ? (
          <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2.5 6.2 5 8.5l4.5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      <span onClick={() => onChange(!checked)}>
        <span className="text-fg block text-[13px]">{label}</span>
        {description ? <span className="text-faint block text-xs">{description}</span> : null}
      </span>
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-accent" : "bg-active",
      )}
    >
      <span
        className={cn(
          "bg-fg inline-block size-4 rounded-full shadow transition-transform",
          checked ? "bg-accent-fg translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "border-line-strong bg-raised text-muted inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-mono text-[10px]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
