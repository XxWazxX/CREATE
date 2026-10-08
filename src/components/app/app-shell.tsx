"use client";

import { PlayerBar } from "@/components/player/player-bar";
import { DialogHost } from "@/components/dialogs/dialog-host";
import { CommandPalette } from "./command-palette";
import { Providers } from "./providers";
import { GlobalDropzone, KeyboardShortcuts, MobileNav, MobileTopBar, SettingsSync, UploadPanel } from "./shell-parts";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="flex h-dvh flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileTopBar />
            <main id="app-scroll" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              {children}
            </main>
          </div>
        </div>
        <PlayerBar />
        <MobileNav />
      </div>
      <CommandPalette />
      <DialogHost />
      <UploadPanel />
      <GlobalDropzone />
      <KeyboardShortcuts />
      <SettingsSync />
    </Providers>
  );
}
