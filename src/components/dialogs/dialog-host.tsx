"use client";

import { useUI } from "@/lib/ui-store";
import { ProjectShareDialog } from "./project-share-dialog";
import {
  ConfirmDialog,
  EditTrackDialog,
  MoveDialog,
  MoveProjectDialog,
  ProjectDialog,
  RenameTrackDialog,
} from "./track-dialogs";

/** Single mount point for every modal: one open at a time, Esc closes. */
export function DialogHost() {
  const dialog = useUI((s) => s.dialog);
  const close = useUI((s) => s.closeDialog);
  return (
    <>
      {dialog?.type === "edit" ? (
        <EditTrackDialog key={dialog.trackId} trackId={dialog.trackId} onClose={close} />
      ) : null}
      {dialog?.type === "project-share" ? (
        <ProjectShareDialog
          key={dialog.projectId + (dialog.view ?? "")}
          projectId={dialog.projectId}
          initialView={dialog.view}
          onClose={close}
        />
      ) : null}
      {dialog?.type === "move" ? <MoveDialog trackIds={dialog.trackIds} onClose={close} /> : null}
      {dialog?.type === "rename-track" ? <RenameTrackDialog trackId={dialog.trackId} onClose={close} /> : null}
      {dialog?.type === "project" ? <ProjectDialog state={dialog} onClose={close} /> : null}
      {dialog?.type === "move-project" ? <MoveProjectDialog projectId={dialog.projectId} onClose={close} /> : null}
      <ConfirmDialog />
    </>
  );
}
