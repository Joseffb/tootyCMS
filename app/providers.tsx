"use client";

import { Toaster } from "sonner";
import { ModalProvider } from "@/components/modal/provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Render a single Toaster that styles itself based on dark mode */}
      <Toaster className="toaster-container" />
      <ModalProvider>{children}</ModalProvider>
    </>
  );
}
