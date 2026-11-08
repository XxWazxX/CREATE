"use client";

import { generatedArt, useSignedUrl } from "@/components/ui/cover";
import { usePlayer } from "@/lib/player/store";

/**
 * Soft, heavily blurred halo of the playing prod's cover behind the whole app
 * (same idea as the listening page): it gives the glass panels something to
 * show through. Nothing playing → pure black.
 */
export function AmbientHalo() {
  const current = usePlayer((s) => s.current);
  const cover = useSignedUrl(current?.coverPath ?? null);
  if (!current) return null;
  return (
    <div className="app-ambient" aria-hidden>
      <div
        key={`${current.trackId}:${cover ?? ""}`}
        className="app-ambient-layer"
        style={cover ? { backgroundImage: `url("${cover}")` } : generatedArt(current.trackId)}
      />
    </div>
  );
}
