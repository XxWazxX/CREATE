import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-110 active:brightness-95",
  secondary: "bg-raised text-fg hover:bg-hover border border-line",
  outline: "border border-line-strong text-fg hover:bg-hover",
  ghost: "text-muted hover:text-fg hover:bg-hover",
  danger: "bg-danger/15 text-danger hover:bg-danger/25",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5 rounded-md",
  md: "h-8 px-3 text-[13px] gap-2 rounded-lg",
  lg: "h-10 px-4 text-sm gap-2 rounded-lg",
  icon: "h-8 w-8 rounded-lg justify-center",
  "icon-sm": "h-7 w-7 rounded-md justify-center",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center font-medium whitespace-nowrap transition-[background-color,color,filter,opacity] duration-100 select-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-3.5" /> : null}
      {children}
    </button>
  );
});
