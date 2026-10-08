import { hashPassword } from "@/lib/project-share-server";
import { createClient } from "@/lib/supabase/server";
import { publicShape, SHARE_COLUMNS, ShareInput } from "@/lib/project-share-input";

/** Updates a link's permissions, expiry, label or password (RLS: owner only). */
export async function PATCH(req: Request, ctx: RouteContext<"/api/project-shares/[id]">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "Non autorisé" }, { status: 401 });

  const parsed = ShareInput.partial().safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Requête invalide" }, { status: 400 });
  const { password, ...fields } = parsed.data;
  const patch: Record<string, unknown> = { ...fields };
  if (password !== undefined) patch.password_hash = password ? await hashPassword(password) : null;

  const { data, error } = await supabase
    .from("project_shares")
    .update(patch)
    .eq("id", id)
    .select(SHARE_COLUMNS)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Lien introuvable" }, { status: 404 });
  return Response.json(publicShape(data));
}
