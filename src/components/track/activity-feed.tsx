import {
  ArrowRightLeft,
  Eye,
  FilePlus2,
  Layers,
  Link2,
  Link2Off,
  Mail,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import type { Activity } from "@/lib/types";
import { relativeDate } from "@/lib/utils";

const FIELD_LABELS: Record<string, string> = {
  title: "titre",
  artist: "artiste",
  producer: "producteur",
  bpm: "BPM",
  key: "tonalité",
  genre: "genre",
  cover: "pochette",
};

function describe(a: Activity): { icon: React.ComponentType<{ className?: string }>; text: string } {
  const d = a.data as Record<string, unknown>;
  switch (a.type) {
    case "created":
      return { icon: Upload, text: `Importé${d.filename ? ` ${d.filename}` : ""}` };
    case "edited": {
      const fields = ((d.fields as string[]) ?? []).map((f) => FIELD_LABELS[f] ?? f);
      return { icon: Pencil, text: `Modifié : ${fields.join(", ")}` };
    }
    case "moved":
      return { icon: ArrowRightLeft, text: d.project_name ? `Déplacé dans ${d.project_name}` : "Retiré du projet" };
    case "version_added":
      return { icon: FilePlus2, text: `Version ${d.label ?? ""} ajoutée` };
    case "current_version":
      return { icon: Star, text: `${d.label ?? "Une version"} définie comme actuelle` };
    case "stem_added":
      return { icon: Layers, text: `Stem ${d.name ?? ""} ajouté` };
    case "shared":
      return { icon: Link2, text: d.recipient ? `Lien créé pour ${d.recipient}` : "Lien privé créé" };
    case "share_opened":
      return { icon: Eye, text: d.recipient ? `Ouvert par ${d.recipient}` : "Lien ouvert" };
    case "share_revoked":
      return { icon: Link2Off, text: "Lien révoqué" };
    case "emailed":
      return { icon: Mail, text: `Envoyé à ${d.recipient ?? "quelqu'un"}` };
    case "trashed":
      return { icon: Trash2, text: "Mis à la corbeille" };
    case "restored":
      return { icon: RotateCcw, text: "Restauré" };
    default:
      return { icon: Pencil, text: a.type };
  }
}

export function ActivityFeed({ activity }: { activity: Activity[] }) {
  if (!activity.length) return <p className="text-faint text-[13px]">Aucune activité pour l’instant.</p>;
  return (
    <ol className="before:bg-line relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px">
      {activity.map((a) => {
        const { icon: Icon, text } = describe(a);
        return (
          <li key={a.id} className="relative flex items-start gap-3">
            <span className="border-line bg-panel text-muted relative z-10 grid size-6 shrink-0 place-items-center rounded-full border">
              <Icon className="size-3" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[12.5px] leading-snug">{text}</p>
              <p className="text-faint text-[11px]" title={new Date(a.created_at).toLocaleString("fr-FR")}>
                {relativeDate(a.created_at)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
