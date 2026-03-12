import { describe, expect, it } from "vitest";
import {
  filterTabsForDomain,
  isPluginEditorMetaKey,
  pluginEditorFieldMetaKey,
  pluginEditorMetaPrefix,
  readPluginEditorFieldValue,
  sortEditorPluginTabs,
  writePluginEditorFieldValue,
} from "@/lib/editor-plugin-tabs";
import type { PluginEditorTab } from "@/lib/extension-contracts";

describe("editor plugin tabs", () => {
  it("builds stable plugin meta prefixes and field keys", () => {
    expect(pluginEditorMetaPrefix("Tooty Story Teller")).toBe("_plugin_tooty_story_teller_");
    expect(
      pluginEditorFieldMetaKey("Tooty Story Teller", { key: "story_enabled", metaKey: undefined }),
    ).toBe("_plugin_tooty_story_teller_story_enabled");
    expect(isPluginEditorMetaKey("Tooty Story Teller", "_plugin_tooty_story_teller_story_enabled")).toBe(true);
    expect(isPluginEditorMetaKey("Tooty Story Teller", "_publish_at")).toBe(false);
  });

  it("reads and writes simple, media, and repeater values", () => {
    const checkboxField = { key: "story_enabled", label: "Enable", type: "checkbox" } as const;
    const mediaField = { key: "intro_media", label: "Media", type: "media" } as const;
    const repeaterField = { key: "artifacts", label: "Artifacts", type: "repeater" } as const;

    let entries: Array<{ key: string; value: string }> = [];
    entries = writePluginEditorFieldValue(entries, "tooty-story-teller", checkboxField, true);
    entries = writePluginEditorFieldValue(entries, "tooty-story-teller", mediaField, {
      mediaId: "44",
      url: "https://cdn.example.com/audio.mp3",
      mimeType: "audio/mpeg",
      label: "Intro",
    });
    entries = writePluginEditorFieldValue(entries, "tooty-story-teller", repeaterField, [
      { title: "Recovered Log", mode: "modal" },
    ]);

    expect(readPluginEditorFieldValue(entries, "tooty-story-teller", checkboxField)).toBe(true);
    expect(readPluginEditorFieldValue(entries, "tooty-story-teller", mediaField)).toEqual({
      mediaId: "44",
      url: "https://cdn.example.com/audio.mp3",
      mimeType: "audio/mpeg",
      label: "Intro",
    });
    expect(readPluginEditorFieldValue(entries, "tooty-story-teller", repeaterField)).toEqual([
      { title: "Recovered Log", mode: "modal" },
    ]);
  });

  it("sorts tabs by order and filters by supported domains", () => {
    const tabs: PluginEditorTab[] = [
      { id: "story", label: "Story", order: 320, supportsDomains: ["post"], sections: [{ id: "a", title: "A", fields: [] }] },
      { id: "seo", label: "SEO", order: 310, supportsDomains: ["page"], sections: [{ id: "b", title: "B", fields: [] }] },
    ];

    expect(sortEditorPluginTabs(tabs).map((tab) => tab.id)).toEqual(["seo", "story"]);
    expect(filterTabsForDomain(tabs, "post").map((tab) => tab.id)).toEqual(["story"]);
  });
});
