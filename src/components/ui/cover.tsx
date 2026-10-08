"use client";

import { useEffect, useState } from "react";
import { peekSignedUrl, signedUrl } from "@/lib/storage";
import { cn, hashString } from "@/lib/utils";

/** Signed URL for a private storage path (batched + cached). */
export function useSignedUrl(path: string | null | undefined) {
  const [resolved, setResolved] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!path || peekSignedUrl(path)) return;
    let alive = true;
    signedUrl(path).then((url) => alive && setResolved({ path, url }));
    return () => {
      alive = false;
    };
  }, [path]);
  if (!path) return null;
  return peekSignedUrl(path) ?? (resolved?.path === path ? resolved.url : null);
}

/** Deterministic, quiet artwork for tracks without a cover. */
export function generatedArt(seed: string) {
  const h = hashString(seed);
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + ((h >> 9) % 80)) % 360;
  const angle = (h >> 4) % 360;
  const x = 20 + ((h >> 12) % 60);
  const y = 20 + ((h >> 16) % 60);
  return {
    backgroundImage: `radial-gradient(circle at ${x}% ${y}%, hsl(${hue1} 45% 42% / 0.95), transparent 60%), linear-gradient(${angle}deg, hsl(${hue2} 35% 22%), hsl(${hue1} 25% 12%))`,
  };
}

export function Cover({
  path,
  seed,
  className,
  rounded = "rounded-md",
  children,
}: {
  path: string | null | undefined;
  seed: string;
  className?: string;
  rounded?: string;
  children?: React.ReactNode;
}) {
  const url = useSignedUrl(path);
  const [loaded, setLoaded] = useState<string | null>(null);
  return (
    <div className={cn("bg-raised relative shrink-0 overflow-hidden", rounded, className)} style={generatedArt(seed)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(url)}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-200",
            loaded === url ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
      {children}
    </div>
  );
}
