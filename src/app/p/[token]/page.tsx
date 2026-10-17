import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/app/sidebar";
import { publicProjectTracks, resolveProjectShare, shareHit, signedUrl } from "@/lib/project-share-server";
import { instagramHandle } from "@/lib/email/template";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";
import { PasswordGate } from "./password-gate";
import { ProjectPlayer, type Brand } from "./project-player";

export const metadata: Metadata = {
  title: "Projet partagé",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ProjectSharePage({ params }: PageProps<"/p/[token]">) {
  return (
    <Suspense fallback={<div className="bg-bg min-h-dvh" />}>
      <Content params={params} />
    </Suspense>
  );
}

function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="bg-bg flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo className="mb-6 size-8" />
      <p className="text-lg font-medium">{title}</p>
      {children ? <p className="text-muted mt-1 max-w-sm text-sm">{children}</p> : null}
    </main>
  );
}

async function Content({ params }: { params: PageProps<"/p/[token]">["params"] }) {
  const { token } = await params;
  const r = await resolveProjectShare(token).catch((e) => {
    console.error("[p] could not resolve link:", e);
    return { status: "not_found" as const };
  });

  if (r.status === "not_found") {
    return <Message title="Ce lien n’est plus disponible">Il a peut-être été supprimé par son propriétaire.</Message>;
  }
  if (r.status === "expired") {
    return (
      <Message title="Ce lien de partage a expiré.">Demande un nouveau lien à la personne qui te l’a envoyé.</Message>
    );
  }
  if (r.status === "locked") return <PasswordGate token={token} projectName={r.project.name} />;

  const { share, project } = r;
  const [tracks, coverUrl, brand] = await Promise.all([
    publicProjectTracks(share),
    project.cover_path ? signedUrl(project.cover_path, 60 * 60 * 6) : Promise.resolve(null),
    ownerBrand(share.id),
  ]);
  await shareHit(share.id, "view").catch(() => undefined);

  return (
    <ProjectPlayer
      token={token}
      brand={brand}
      project={{ id: project.id, name: project.name, coverUrl }}
      tracks={tracks}
      permissions={{
        streaming: share.allow_streaming,
        mp3: share.allow_mp3_download,
        wav: share.allow_wav_download,
        stems: share.allow_stems_download,
      }}
    />
  );
}

/** Name, logo and Instagram of the link's owner (public, non-sensitive settings only). */
async function ownerBrand(shareId: string): Promise<Brand> {
  const fallback: Brand = {
    name: "WAZ",
    logoUrl: null,
    instagram: null,
    heroUrl: "/brand/studio.jpg",
  };
  try {
    const admin = createAdminClient();
    const { data: share } = await admin.from("project_shares").select("user_id").eq("id", shareId).single();
    if (!share) return fallback;
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name, settings")
      .eq("id", share.user_id)
      .maybeSingle();
    const settings = (profile?.settings as Settings | null) ?? null;
    const email = { ...DEFAULT_SETTINGS.email, ...(settings?.email ?? {}) };
    const logoPath = settings?.emailDesign?.logoPath ?? null;
    return {
      name: email.fromName || profile?.display_name || fallback.name,
      logoUrl: logoPath ? await signedUrl(logoPath, 60 * 60 * 6) : null,
      instagram: instagramHandle(email.instagram),
      heroUrl: fallback.heroUrl,
    };
  } catch {
    return fallback;
  }
}
