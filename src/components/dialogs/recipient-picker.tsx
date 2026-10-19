"use client";

import { Check, Search, Users, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { ARTIST_EMAIL_RE, splitEmails } from "@/lib/artists/parse";
import { filterArtists, useArtistFolders, useArtists } from "@/lib/data/artists";
import { cn } from "@/lib/utils";

const MAX_SHOWN = 100;

/**
 * Recipients field: search the artist base by name or email, tick one or many,
 * or type any address. Selected recipients show as removable chips.
 */
export function RecipientPicker({
  value,
  onChange,
  pending,
  onPendingChange,
  autoFocus,
}: {
  value: string[];
  onChange: (emails: string[]) => void;
  /** Text typed but not turned into a chip yet (the form refuses to send while it's invalid). */
  pending: string;
  onPendingChange: (text: string) => void;
  autoFocus?: boolean;
}) {
  const { data: artists = [], error } = useArtists();
  const [browse, setBrowse] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => new Set(value), [value]);
  const nameOf = useMemo(() => new Map(artists.map((a) => [a.email, a.artist_name])), [artists]);

  const query = pending.trim();
  const { data: folderState } = useArtistFolders();
  const folders = folderState?.folders ?? [];
  /** Browse one folder (e.g. "RAP US") — "" = every artist. */
  const [folder, setFolder] = useState("");
  const pool = useMemo(() => (folder ? artists.filter((a) => a.folder_id === folder) : artists), [artists, folder]);
  const results = useMemo(() => (query || browse ? filterArtists(pool, query) : []), [pool, query, browse]);
  const shown = results.slice(0, MAX_SHOWN);
  // "Select all" takes every result (a whole folder), not only the rows displayed.
  const allSelected = results.length > 0 && results.every((a) => selected.has(a.email));

  const add = (emails: string[]) => onChange([...new Set([...value, ...emails.map((e) => e.toLowerCase())])]);
  const remove = (email: string) => onChange(value.filter((e) => e !== email));
  const toggle = (email: string) => (selected.has(email) ? remove(email) : add([email]));

  /** Turns typed / pasted addresses into chips; keeps whatever isn't a valid address. */
  const commit = (text: string) => {
    const parts = splitEmails(text);
    const valid = parts.filter((p) => ARTIST_EMAIL_RE.test(p));
    if (valid.length) add(valid);
    onPendingChange(parts.filter((p) => !ARTIST_EMAIL_RE.test(p)).join(" "));
  };

  return (
    <div>
      <div
        className="border-line bg-raised focus-within:border-line-strong flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((email) => (
          <span
            key={email}
            className="bg-hover text-fg inline-flex max-w-full items-center gap-1 rounded-md py-0.5 pr-1 pl-2 text-xs"
            title={email}
          >
            <span className="truncate">
              {nameOf.get(email) ? (
                <>
                  {nameOf.get(email)} <span className="text-faint">· {email}</span>
                </>
              ) : (
                email
              )}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(email);
              }}
              className="text-faint hover:text-fg rounded p-0.5"
              aria-label={`Retirer ${email}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <div className="flex min-w-40 flex-1 items-center gap-1.5">
          <Search className="text-faint size-3.5 shrink-0" />
          <input
            ref={inputRef}
            data-autofocus={autoFocus || undefined}
            value={pending}
            onChange={(e) => {
              const v = e.target.value;
              // Typing a separator after an address turns it into a chip.
              if (/[,;]\s*$/.test(v) && ARTIST_EMAIL_RE.test(v.replace(/[,;\s]+$/, "").trim())) commit(v);
              else onPendingChange(v);
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (splitEmails(text).length > 1) {
                e.preventDefault();
                commit(`${pending} ${text}`);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !(e.metaKey || e.ctrlKey) && query) {
                e.preventDefault();
                if (ARTIST_EMAIL_RE.test(query)) commit(query);
                else if (shown.length === 1) {
                  toggle(shown[0].email);
                  onPendingChange("");
                }
              } else if (e.key === "Backspace" && !pending && value.length) {
                remove(value[value.length - 1]);
              } else if (e.key === "Escape" && (query || browse)) {
                e.preventDefault();
                e.stopPropagation();
                onPendingChange("");
                setBrowse(false);
              }
            }}
            onBlur={() => query && ARTIST_EMAIL_RE.test(query) && commit(query)}
            placeholder={value.length ? "Ajouter…" : "Rechercher un artiste ou saisir une adresse"}
            className="placeholder:text-faint h-6 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            inputMode="email"
            autoComplete="off"
            aria-label="Destinataires"
          />
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 text-[11.5px]">
        {error ? (
          <span className="text-faint">Base d’artistes indisponible — saisis les adresses à la main.</span>
        ) : artists.length ? (
          <button
            type="button"
            onClick={() => setBrowse((b) => !b)}
            className="text-muted hover:text-fg inline-flex items-center gap-1"
          >
            <Users className="size-3.5" />
            {browse && !query ? "Masquer les artistes" : `Parcourir les artistes (${artists.length})`}
          </button>
        ) : (
          <Link href="/artists" className="text-muted hover:text-fg inline-flex items-center gap-1">
            <Users className="size-3.5" /> Ajouter des artistes
          </Link>
        )}
        {value.length ? (
          <span className="text-faint">
            {value.length} destinataire{value.length > 1 ? "s" : ""}
          </span>
        ) : null}
      </div>

      {(query || browse) && folders.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {[{ id: "", name: "Tous" }, ...folders].map((f) => (
            <button
              key={f.id || "all"}
              type="button"
              onClick={() => setFolder(f.id)}
              className={cn(
                "h-6 rounded-md border px-2 text-[11.5px]",
                folder === f.id ? "border-line-strong bg-hover text-fg" : "border-line text-muted hover:text-fg",
              )}
            >
              {f.name}
              {f.id ? (
                <span className="text-faint ml-1">{artists.filter((a) => a.folder_id === f.id).length}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {query || browse ? (
        <div className="border-line mt-2 overflow-hidden rounded-lg border">
          {shown.length ? (
            <>
              <div className="border-line bg-panel flex items-center justify-between border-b px-3 py-1.5 text-[11.5px]">
                <span className="text-faint">
                  {results.length} artiste{results.length > 1 ? "s" : ""}
                  {results.length > MAX_SHOWN ? ` · ${MAX_SHOWN} affichés` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const emails = new Set(results.map((a) => a.email));
                    if (allSelected) onChange(value.filter((e) => !emails.has(e)));
                    else add([...emails]);
                  }}
                  className="text-muted hover:text-fg"
                >
                  {allSelected ? "Tout désélectionner" : `Tout sélectionner (${results.length})`}
                </button>
              </div>
              <ul className="max-h-56 overflow-y-auto">
                {shown.map((a) => {
                  const on = selected.has(a.email);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => toggle(a.email)}
                        className="hover:bg-hover flex w-full items-center gap-2.5 px-3 py-1.5 text-left"
                        aria-pressed={on}
                      >
                        <span
                          className={cn(
                            "grid size-4 shrink-0 place-items-center rounded border",
                            on ? "bg-accent border-accent text-accent-fg" : "border-line-strong",
                          )}
                        >
                          {on ? <Check className="size-3" strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {a.artist_name} <span className="text-faint">— {a.email}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="text-faint px-3 py-2 text-[12px]">
              {ARTIST_EMAIL_RE.test(query)
                ? "Adresse hors de ta base : appuie sur Entrée pour l’ajouter."
                : "Aucun artiste ne correspond."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
