"use client";

import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="data-[state=open]:animate-in fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <D.Content
          className={cn(
            "border-line bg-panel data-[state=open]:animate-pop fixed top-[12vh] left-1/2 z-50 flex max-h-[80vh] w-[calc(100vw-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/50 outline-none",
            wide ? "max-w-2xl" : "max-w-md",
            className,
          )}
          onOpenAutoFocus={(e) => {
            // Focus the first field rather than the close button.
            const el = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
              "[data-autofocus], input:not([type=hidden]), textarea",
            );
            if (el) {
              e.preventDefault();
              el.focus();
            }
          }}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
            <div className="min-w-0">
              <D.Title className="truncate text-[15px] font-semibold">{title}</D.Title>
              {description ? (
                <D.Description className="text-muted mt-0.5 text-[13px]">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</D.Description>
              )}
            </div>
            <D.Close className="text-faint hover:bg-hover hover:text-fg -mr-1.5 rounded-md p-1" aria-label="Fermer">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          {footer ? (
            <div className="border-line flex items-center justify-end gap-2 border-t px-5 py-3">{footer}</div>
          ) : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
