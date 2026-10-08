import { createAdminClient } from "@/lib/supabase/admin";
import { setUnlockCookie, verifyPassword } from "@/lib/project-share-server";

// Small in-memory brake against password guessing (per server instance).
const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: Request, ctx: RouteContext<"/api/p/[token]/unlock">) {
  const { token } = await ctx.params;
  const key = `${token}:${req.headers.get("x-forwarded-for") ?? "local"}`;
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.n >= 5) {
    return Response.json({ error: "Trop de tentatives. Réessaie dans une minute." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const admin = createAdminClient();
  const { data: share } = await admin
    .from("project_shares")
    .select("id, password_hash, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!share) return Response.json({ error: "Lien introuvable" }, { status: 404 });
  if (share.expires_at && new Date(share.expires_at) <= new Date()) {
    return Response.json({ error: "Ce lien de partage a expiré." }, { status: 410 });
  }
  if (!share.password_hash) return Response.json({ ok: true });

  const ok = typeof body.password === "string" && (await verifyPassword(body.password, share.password_hash));
  if (!ok) {
    const cur = a && a.until > Date.now() ? a : { n: 0, until: Date.now() + 60_000 };
    attempts.set(key, { n: cur.n + 1, until: cur.until });
    return Response.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }
  attempts.delete(key);
  await setUnlockCookie(share);
  return Response.json({ ok: true });
}
