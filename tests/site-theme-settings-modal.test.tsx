// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SiteThemeSettingsModal from "@/components/site-theme-settings-modal";

vi.mock("@/components/media/media-picker-field", () => ({
  default: ({ label, name }: { label: string; name: string }) => (
    <div data-testid={`media-field-${name}`}>{label}</div>
  ),
}));

describe("SiteThemeSettingsModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens in a portal and closes via cancel", () => {
    render(
      <SiteThemeSettingsModal
        siteId="site-1"
        themeId="theme-1"
        themeName="Robert Betan Subdomain"
        fields={[
          { key: "hero_title", label: "Hero Title", type: "text" },
          { key: "hero_image", label: "Hero Image", type: "media" },
        ]}
        config={{}}
        action={async () => {}}
      />,
    );

    expect(screen.queryByText("Robert Betan Subdomain Settings")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Theme Settings" }));

    expect(screen.getByText("Robert Betan Subdomain Settings")).toBeTruthy();
    expect(screen.getByTestId("media-field-hero_image")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Robert Betan Subdomain Settings")).toBeNull();
  });

  it("renders textarea fields with the configured default value", () => {
    render(
      <SiteThemeSettingsModal
        siteId="site-1"
        themeId="theme-1"
        themeName="Theme"
        fields={[{ key: "hero_subtitle", label: "Hero Subtitle", type: "textarea" }]}
        config={{ hero_subtitle: "A new signal rises from the dark." }}
        action={async () => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Theme Settings" }));

    const textarea = screen.getByDisplayValue("A new signal rises from the dark.");
    expect(textarea).toBeTruthy();
  });
});
