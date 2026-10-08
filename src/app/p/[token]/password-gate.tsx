"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/app/sidebar";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function PasswordGate({ token, projectName }: { token: string; projectName: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/p/${token}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.refresh();
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setError(json.error ?? "Mot de passe incorrect");
    setLoading(false);
  };

  return (
    <main className="bg-bg flex min-h-dvh items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="animate-up border-line bg-panel w-full max-w-sm rounded-2xl border p-6 text-center"
      >
        <Logo className="mx-auto mb-5 size-7" />
        <h1 className="text-xl font-semibold tracking-tight">{projectName}</h1>
        <p className="text-muted mt-1 flex items-center justify-center gap-1.5 text-[13px]">
          <Lock className="size-3.5" /> Ce projet est protégé.
        </p>
        <div className="mt-6 text-left">
          <Label htmlFor="pw">Mot de passe</Label>
          <Input
            id="pw"
            type="password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error ? <p className="text-danger mt-3 text-left text-[13px]">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" loading={loading} className="mt-4 w-full justify-center">
          Continuer
        </Button>
      </form>
    </main>
  );
}
