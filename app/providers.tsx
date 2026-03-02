"use client";

import { Toaster } from "sonner";
import { MediaManagerSurfaceProvider } from "@/components/media/media-manager-surface";
import { ModalProvider } from "@/components/modal/provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Render a single Toaster that styles itself based on dark mode */}
      <Toaster className="toaster-container" />
      <ModalProvider>
        <MediaManagerSurfaceProvider>{children}</MediaManagerSurfaceProvider>
      </ModalProvider>
    </>
  );
}
