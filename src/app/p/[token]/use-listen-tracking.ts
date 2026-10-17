"use client";

import { useEffect, useMemo, useRef } from "react";
import { ListenTracker, type ListenEvent } from "@/lib/analytics/listen-tracker";

/** Batched every 15 s at most — never one request per time update. */
const FLUSH_MS = 15_000;

function sessionToken(token: string) {
  const key = `cr_ls_${token.slice(0, 12)}`;
  try {
    const got = sessionStorage.getItem(key);
    if (got) return got;
    const fresh = newToken();
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return newToken(); // storage blocked: one session per page load
  }
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Measures listening on the public page and sends it in small batches
 * (periodically, after a pause / end / track change, and when the tab is
 * hidden or closed). Failed sends are retried; event keys keep them idempotent.
 */
export function useListenTracking(token: string, enabled: boolean) {
  const tracker = useMemo(() => new ListenTracker(), []);
  const flushRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!enabled) return;
    const session = sessionToken(token);
    const url = `/api/p/${token}/listen`;
    const payload = (events: ListenEvent[]) => JSON.stringify({ session, events, now: Date.now() });
    let sending = false;

    const flush = async () => {
      if (sending) return;
      const events = tracker.drain();
      if (!events.length) return;
      sending = true;
      try {
        for (let i = 0; i < events.length; i += 100) {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "text/plain;charset=UTF-8" },
            body: payload(events.slice(i, i + 100)),
            keepalive: true,
          });
          if (res.status >= 500) throw new Error(String(res.status));
        }
      } catch {
        tracker.requeue(events);
      } finally {
        sending = false;
      }
    };
    flushRef.current = () => void flush();

    /** Page going away: last chance, fire-and-forget. */
    const beacon = () => {
      tracker.tick();
      const events = tracker.drain();
      if (!events.length) return;
      const ok =
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon(url, new Blob([payload(events.slice(0, 100))], { type: "text/plain;charset=UTF-8" }));
      if (!ok) tracker.requeue(events);
    };

    const timer = window.setInterval(() => {
      tracker.tick();
      void flush();
    }, FLUSH_MS);
    const onVisibility = () => document.visibilityState === "hidden" && beacon();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", beacon);
    return () => {
      flushRef.current = () => undefined;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", beacon);
      beacon();
    };
  }, [token, enabled, tracker]);

  return {
    tracker,
    /** Sends what's queued shortly (lets a following event join the same request). */
    flushSoon: () => window.setTimeout(() => flushRef.current(), 300),
  };
}
