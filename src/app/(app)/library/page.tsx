"use client";

import { LibraryView } from "@/components/track/library-view";
import { PageHeader } from "@/components/ui/misc";
import { useTracks } from "@/lib/data/tracks";

export default function LibraryPage() {
  const { data } = useTracks();
  return (
    <LibraryView
      header={
        <PageHeader
          title="Bibliothèque"
          subtitle={data ? `${data.length} morceau${data.length > 1 ? "x" : ""}` : " "}
          className="pb-1"
        />
      }
    />
  );
}
