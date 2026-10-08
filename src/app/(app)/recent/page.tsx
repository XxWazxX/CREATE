"use client";

import { Clock } from "lucide-react";
import { LibraryView } from "@/components/track/library-view";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import type { Track } from "@/lib/types";

const THIRTY_DAYS = 30 * 86_400_000;
const recent = (t: Track) => Date.now() - new Date(t.created_at).getTime() < THIRTY_DAYS;

export default function RecentPage() {
  return (
    <LibraryView
      scope={recent}
      defaultSort={{ key: "created_at", dir: "desc" }}
      header={<PageHeader title="Ajouts récents" subtitle="30 derniers jours" className="pb-1" />}
      emptyState={<EmptyState icon={Clock} title="Rien d'ajouté ces 30 derniers jours" />}
    />
  );
}
