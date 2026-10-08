import { z } from "zod";
import { publicShape, SHARE_COLUMNS, ShareInput } from "@/lib/project-share-input";
import { hashPassword, newShareToken } from "@/lib/project-share-server";
import { createClient } from "@/lib/supabase/server";

/** Creates a project link: secure token + hashed password, stored under the owner's RLS. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = ShareInput.extend({ projectId: z.uuid() }).safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Requête invalide" }, { status: 400 });
  const { projectId, password, ...fields } = parsed.data;

  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return Response.json({ error: "Projet introuvable" }, { status: 404 });

  const { data, error } = await supabase
    .from("project_shares")
    .insert({
      ...fields,
      project_id: projectId,
      token: newShareToken(),
      password_hash: password ? await hashPassword(password) : null,
    })
    .select(SHARE_COLUMNS)
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(publicShape(data));
}
