"use client";

import { create } from "zustand";

export type DialogState =
  | { type: "edit"; trackId: string }
  | { type: "project-share"; projectId: string; view?: "email" }
  | { type: "move"; trackIds: string[] }
  | { type: "rename-track"; trackId: string }
  | { type: "project"; mode: "create"; kind: "project" | "folder"; parentId?: string | null; moveTrackIds?: string[] }
  | { type: "project"; mode: "rename"; projectId: string }
  | { type: "move-project"; projectId: string }
  | null;

type ConfirmRequest = {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
};

type UIState = {
  dialog: DialogState;
  confirmReq: ConfirmRequest | null;
  paletteOpen: boolean;
  /** Track targeted by keyboard shortcuts when not the playing one (detail page / hovered row). */
  focusTrackId: string | null;
  uploadTarget: { projectId: string | null } | null;
  openDialog: (d: DialogState) => void;
  closeDialog: () => void;
  setPalette: (open: boolean) => void;
  setFocusTrack: (id: string | null) => void;
  requestUpload: (projectId?: string | null) => void;
  clearUploadRequest: () => void;
};

export const useUI = create<UIState>((set) => ({
  dialog: null,
  confirmReq: null,
  paletteOpen: false,
  focusTrackId: null,
  uploadTarget: null,
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setFocusTrack: (focusTrackId) => set({ focusTrackId }),
  requestUpload: (projectId = null) => set({ uploadTarget: { projectId } }),
  clearUploadRequest: () => set({ uploadTarget: null }),
}));

export function confirm(opts: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  return new Promise((resolve) => useUI.setState({ confirmReq: { ...opts, resolve } }));
}
