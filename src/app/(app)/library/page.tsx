"use client";

import { LibraryView } from "@/components/track/library-view";
import { PageHeader } from "@/components/ui/misc";
import { useSearchParams } from "next/navigation";
import { useTracks } from "@/lib/data/tracks";

export default function LibraryPage() {
  const { data } = useTracks();
  // Inside a project folder, "Importer" adds to that project.
  const projectId = useSearchParams().get("projet");
  return (
    <LibraryView
      folders
      uploadProjectId={projectId}
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
