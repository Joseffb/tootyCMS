"use client";

import { useState } from "react";
import {
  type MediaSelection,
  type OpenMediaPickerOptions,
  useMediaManagerSurface,
} from "@/components/media/media-manager-surface";
import MediaManagerModal from "@/components/media/media-manager-modal";

export function useMediaPicker() {
  const registeredSurface = useMediaManagerSurface();
  const [config, setConfig] = useState<OpenMediaPickerOptions | null>(null);

  function openMediaPicker(options: OpenMediaPickerOptions) {
    if (registeredSurface) {
      registeredSurface.openMediaPicker(options);
      return;
    }
    setConfig(options);
  }

  function closeMediaPicker() {
    if (registeredSurface) {
      registeredSurface.closeMediaPicker();
      return;
    }
    setConfig(null);
  }

  const mediaPickerElement =
    registeredSurface || !config ? null : (
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
    );

  return {
    openMediaPicker,
    closeMediaPicker,
    mediaPickerElement,
    isMediaPickerOpen: registeredSurface ? registeredSurface.isMediaPickerOpen : Boolean(config),
  };
}

export type { MediaSelection };
