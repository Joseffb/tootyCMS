"use client";

import { createContext, useContext, useMemo, useState } from "react";
import MediaManagerModal, { type MediaSelection } from "@/components/media/media-manager-modal";

export const MEDIA_MANAGER_SURFACE_ID = "media.manager";

export type OpenMediaPickerOptions = {
  siteId: string;
  mode?: "pick" | "manage";
  title?: string;
  selectedIds?: string[];
  multiSelect?: boolean;
  allowedMimePrefixes?: string[];
  allowUpload?: boolean;
  onSelect?: (items: MediaSelection[]) => void;
};

type SurfaceContextValue = {
  surfaceId: typeof MEDIA_MANAGER_SURFACE_ID;
  openMediaPicker: (options: OpenMediaPickerOptions) => void;
  closeMediaPicker: () => void;
  isMediaPickerOpen: boolean;
};

const MediaManagerSurfaceContext = createContext<SurfaceContextValue | null>(null);

type Props = {
  children: React.ReactNode;
};

export function MediaManagerSurfaceProvider({ children }: Props) {
  const [config, setConfig] = useState<OpenMediaPickerOptions | null>(null);

  function openMediaPicker(options: OpenMediaPickerOptions) {
    setConfig(options);
  }

  function closeMediaPicker() {
    setConfig(null);
  }

  const contextValue = useMemo<SurfaceContextValue>(
    () => ({
      surfaceId: MEDIA_MANAGER_SURFACE_ID,
      openMediaPicker,
      closeMediaPicker,
      isMediaPickerOpen: Boolean(config),
    }),
    [config],
  );

  return (
    <MediaManagerSurfaceContext.Provider value={contextValue}>
      {children}
      {config ? (
        <MediaManagerModal
          open
          onClose={closeMediaPicker}
          siteId={config.siteId}
          mode={config.mode}
          title={config.title}
          selectedIds={config.selectedIds}
          multiSelect={config.multiSelect}
          allowedMimePrefixes={config.allowedMimePrefixes}
          allowUpload={config.allowUpload}
          onSelect={config.onSelect}
        />
      ) : null}
    </MediaManagerSurfaceContext.Provider>
  );
}

export function useMediaManagerSurface() {
  return useContext(MediaManagerSurfaceContext);
}

export type { MediaSelection };
