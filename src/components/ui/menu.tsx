"use client";

import * as CM from "@radix-ui/react-context-menu";
import * as DM from "@radix-ui/react-dropdown-menu";
import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One declarative item list rendered both as a dropdown ("…" button) and as a
 * right-click context menu, so the two never drift apart.
 */
export type MenuEntry =
  | {
      type?: "item";
      label: string;
      icon?: LucideIcon;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { type: "separator" }
  | { type: "label"; label: string }
  | { type: "submenu"; label: string; icon?: LucideIcon; items: MenuEntry[] };

const content =
  "z-50 min-w-52 overflow-hidden rounded-xl border border-line-strong bg-raised p-1 text-[13px] shadow-xl shadow-black/40 data-[state=open]:animate-pop";
const item =
  "relative flex h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2 text-fg outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover [&_svg]:size-4 [&_svg]:text-muted";

function Entries({ entries, kind }: { entries: MenuEntry[]; kind: "dropdown" | "context" }) {
  const P = kind === "dropdown" ? DM : CM;
  return (
    <>
      {entries.map((e, i) => {
        if (e.type === "separator") return <P.Separator key={i} className="bg-line my-1 h-px" />;
        if (e.type === "label")
          return (
            <P.Label key={i} className="text-faint px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide uppercase">
              {e.label}
            </P.Label>
          );
        if (e.type === "submenu") {
          const Icon = e.icon;
          return (
            <P.Sub key={i}>
              <P.SubTrigger className={item}>
                {Icon ? <Icon /> : null}
                <span className="flex-1 truncate">{e.label}</span>
                <ChevronRight className="!size-3.5" />
              </P.SubTrigger>
              <P.Portal>
                <P.SubContent className={cn(content, "max-h-80 overflow-y-auto")} sideOffset={4}>
                  <Entries entries={e.items} kind={kind} />
                </P.SubContent>
              </P.Portal>
            </P.Sub>
          );
        }
        const Icon = e.icon;
        return (
          <P.Item
            key={i}
            disabled={e.disabled}
            onSelect={e.onSelect}
            className={cn(item, e.danger && "text-danger data-[highlighted]:bg-danger/10 [&_svg]:text-danger")}
          >
            {Icon ? <Icon /> : null}
            <span className="flex-1 truncate">{e.label}</span>
            {e.shortcut ? <span className="text-faint font-mono text-[11px]">{e.shortcut}</span> : null}
          </P.Item>
        );
      })}
    </>
  );
}

export function DropdownMenu({
  trigger,
  entries,
  align = "end",
  onOpenChange,
}: {
  trigger: React.ReactNode;
  entries: MenuEntry[];
  align?: "start" | "end" | "center";
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <DM.Root modal={false} onOpenChange={onOpenChange}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={6} className={content} onCloseAutoFocus={(e) => e.preventDefault()}>
          <Entries entries={entries} kind="dropdown" />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function ContextMenu({
  children,
  entries,
  onOpenChange,
}: {
  children: React.ReactNode;
  entries: MenuEntry[] | (() => MenuEntry[]);
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <CM.Root modal={false} onOpenChange={onOpenChange}>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className={content}>
          <Entries entries={typeof entries === "function" ? entries() : entries} kind="context" />
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}
