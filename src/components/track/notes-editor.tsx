"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { updateTrack } from "@/lib/data/tracks";
import { cn, errorMessage } from "@/lib/utils";

/** Notes with debounced autosave (and a flush on unmount / tab close). */
export function NotesEditor({ trackId, initial }: { trackId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(initial);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const v = pending.current;
    if (v == null || v === saved.current) return;
    pending.current = null;
    setState("saving");
    try {
      await updateTrack(trackId, { notes: v });
      saved.current = v;
      setState("saved");
    } catch (e) {
      setState("error");
      setError(errorMessage(e));
      pending.current = v;
    }
  };

  useEffect(() => {
    const onUnload = () => void flush();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Notes</h3>
        <span className={cn("flex items-center gap-1 text-[11px]", state === "error" ? "text-danger" : "text-faint")}>
          {state === "saving" ? (
            <>
              <Spinner className="size-3" /> Enregistrement
            </>
          ) : state === "saved" ? (
            <>
              <Check className="size-3" /> Enregistré
            </>
          ) : state === "error" ? (
            `Non enregistré : ${error}`
          ) : null}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          pending.current = e.target.value;
          setState("idle");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void flush(), 700);
        }}
        onBlur={() => void flush()}
        placeholder={"Envoyer à X\nModifier la 808\nRefaire le refrain\nSingle potentiel"}
        rows={6}
        className="border-line bg-panel placeholder:text-faint focus:border-line-strong w-full resize-y rounded-xl border px-3.5 py-3 text-[13.5px] leading-relaxed outline-none"
      />
    </div>
  );
}
