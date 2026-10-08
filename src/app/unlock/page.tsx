"use client";

import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Logo } from "@/components/app/sidebar";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export default function UnlockPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      const next = new URLSearchParams(window.location.search).get("next");
      // Full navigation so the middleware sees the new cookie.
      window.location.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setError(json.error ?? "Code incorrect");
    setLoading(false);
  };

  return (
    <main className="bg-bg flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="animate-up border-line bg-panel w-full max-w-sm rounded-2xl border p-6">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo className="size-8" />
          <h1 className="text-lg font-semibold tracking-[0.25em]">CREATE</h1>
          <p className="text-muted flex items-center gap-1.5 text-[13px]">
            <KeyRound className="size-3.5" /> Entre ton code d’accès
          </p>
        </div>
        <Label htmlFor="code">Code d’accès</Label>
        <Input
          id="code"
          type="password"
          autoFocus
          required
          autoComplete="current-password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {error ? <p className="text-danger mt-3 text-[13px]">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" loading={loading} className="mt-4 w-full justify-center">
          Continuer
        </Button>
        <p className="text-faint mt-4 text-center text-xs">Demandé une seule fois sur cet appareil.</p>
      </form>
    </main>
  );
}
