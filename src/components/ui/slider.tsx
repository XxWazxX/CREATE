"use client";

import * as S from "@radix-ui/react-slider";
import * as T from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  className,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  label: string;
}) {
  return (
    <S.Root
      className={cn("group relative flex h-5 w-full touch-none items-center select-none", className)}
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onChange(v[0])}
      aria-label={label}
    >
      <S.Track className="bg-active relative h-1 grow overflow-hidden rounded-full">
        <S.Range className="bg-fg group-hover:bg-accent absolute h-full rounded-full" />
      </S.Track>
      <S.Thumb className="bg-fg block size-3 rounded-full opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100" />
    </S.Root>
  );
}

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <T.Root delayDuration={400}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="border-line-strong bg-raised text-fg data-[state=delayed-open]:animate-in z-[60] rounded-md border px-2 py-1 text-xs shadow-lg"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const TooltipProvider = T.Provider;
