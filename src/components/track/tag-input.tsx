"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { TagPill } from "@/components/ui/misc";
import { createTag, useTags } from "@/lib/data/library";
import { cn, errorMessage } from "@/lib/utils";

/** Inline tag editor: type to filter, Enter to add or create, Backspace to remove. */
export function TagInput({
  value,
  onChange,
  className,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const { data: tags = [] } = useTags();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = value.map((id) => tags.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t);

  const suggestions = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tags.filter((t) => !value.includes(t.id) && (!s || t.name.toLowerCase().includes(s))).slice(0, 8);
  }, [tags, q, value]);
  const exact = tags.some((t) => t.name.toLowerCase() === q.trim().toLowerCase());
  const options = [
    ...suggestions.map((t) => ({ id: t.id, label: t.name, create: false })),
    ...(q.trim() && !exact ? [{ id: "__new", label: `Créer « ${q.trim()} »`, create: true }] : []),
  ];

  const add = async (idx: number) => {
    const opt = options[idx];
    if (!opt) return;
    try {
      const id = opt.create ? (await createTag(q)).id : opt.id;
      onChange([...value, id]);
      setQ("");
      setHi(0);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className={cn("relative", className)}>
      <div
        className="border-line bg-raised focus-within:border-line-strong flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5"
        onClick={() => inputRef.current?.focus()}
      >
        {selected.map((t) => (
          <TagPill key={t.id} tag={t} onRemove={() => onChange(value.filter((x) => x !== t.id))} />
        ))}
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setHi(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              if (q.trim() || options.length) {
                e.preventDefault();
                void add(hi);
              }
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(options.length - 1, h + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(0, h - 1));
            } else if (e.key === "Backspace" && !q && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === "Escape" && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          placeholder={selected.length ? "" : "Trap, Dark, Mélodique…"}
          className="placeholder:text-faint h-6 min-w-24 flex-1 bg-transparent text-[13px] outline-none"
        />
      </div>
      {open && options.length ? (
        <div className="border-line-strong bg-raised absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border p-1 shadow-xl">
          {options.map((o, i) => (
            <button
              key={o.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => void add(i)}
              className={cn(
                "block w-full rounded-md px-2 py-1.5 text-left text-[13px]",
                i === hi && "bg-hover",
                o.create && "text-accent",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
