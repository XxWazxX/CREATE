"use client";

import { Heart } from "lucide-react";
import { LibraryView } from "@/components/track/library-view";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import type { Filters } from "@/lib/search";

const PRESET: Filters = { favorites: true };

export default function FavoritesPage() {
  return (
    <LibraryView
      preset={PRESET}
      hideFilters={["favorites"]}
      defaultSort={{ key: "created_at", dir: "desc" }}
      header={<PageHeader title="Favoris" className="pb-1" />}
      emptyState={
        <EmptyState icon={Heart} title="Aucun favori pour l'instant">
          Appuie sur <span className="text-fg font-mono">F</span> ou clique sur le cœur d’un morceau.
        </EmptyState>
      }
    />
  );
}
