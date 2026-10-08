"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Click-to-edit text. Enter / blur saves, Esc cancels. */
export function InlineEdit({
  value,
  onSave,
  placeholder,
  className,
  inputClassName,
  validate,
  inputMode,
}: {
  value: string;
  onSave: (v: string) => unknown;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  validate?: (v: string) => boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  const commit = async () => {
    setEditing(false);
    const v = draft.trim();
    if (v === value.trim()) return;
    if (validate && !validate(v)) {
      setDraft(value);
      return;
    }
    await onSave(v);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        inputMode={inputMode}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(value);
            setEditing(false);
          }
        }}
        className={cn(
          "bg-hover ring-line-strong -mx-1.5 rounded-md px-1.5 ring-1 outline-none",
          className,
          inputClassName,
        )}
        style={{ width: `${Math.max(4, draft.length + 2)}ch`, maxWidth: "100%" }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={cn(
        "hover:bg-hover -mx-1.5 max-w-full truncate rounded-md px-1.5 text-left transition-colors",
        !value && "text-faint",
        className,
      )}
      title="Cliquer pour modifier"
    >
      {value || placeholder}
    </button>
  );
}
