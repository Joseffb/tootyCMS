// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MediaManagerSurfaceProvider,
  MEDIA_MANAGER_SURFACE_ID,
  useMediaManagerSurface,
} from "@/components/media/media-manager-surface";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/media/media-manager-modal", () => ({
  default: function MockMediaManagerModal(props: { title?: string; open?: boolean }) {
    if (!props.open) return null;
    return <div role="dialog" aria-label={props.title || "Media Manager"} />;
  },
}));

function SurfaceProbe() {
  const mediaSurface = useMediaManagerSurface();
  if (!mediaSurface) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          mediaSurface.openMediaPicker({
            siteId: "site-a",
            title: "Media Surface",
            mode: "pick",
            onSelect: () => undefined,
          })
        }
      >
        Open
      </button>
      <span data-testid="surface-id">{mediaSurface.surfaceId}</span>
    </div>
  );
}

describe("MediaManagerSurfaceProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("mounts the canonical media.manager surface once and opens through the shared provider", async () => {
    render(
      <MediaManagerSurfaceProvider>
        <SurfaceProbe />
      </MediaManagerSurfaceProvider>,
    );

    expect(screen.getByTestId("surface-id").textContent).toBe(MEDIA_MANAGER_SURFACE_ID);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Media Surface" })).toBeTruthy());
  });
});
