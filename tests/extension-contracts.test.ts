import { describe, expect, it } from "vitest";
import { validatePluginContract, validateThemeContract } from "@/lib/extension-contracts";

describe("extension contracts", () => {
  it("preserves plugin minimum core version field", () => {
    const plugin = validatePluginContract(
      {
        id: "example-plugin",
        name: "Example Plugin",
        version: "0.1.2",
        minCoreVersion: "0.1.x",
      },
      "example-plugin",
    );
    expect(plugin).not.toBeNull();
    expect(plugin?.minCoreVersion).toBe("0.1.x");
  });

  it("normalizes plugin content meta permission requests and suggested roles", () => {
    const plugin = validatePluginContract(
      {
        id: "content-meta-plugin",
        name: "Content Meta Plugin",
        permissions: {
          contentMeta: {
            requested: true,
            suggestedRoles: [" Administrator ", "editor", "EDITOR"],
          },
        },
      },
      "content-meta-plugin",
    );

    expect(plugin?.permissions).toEqual({
      contentMeta: {
        requested: true,
        suggestedRoles: ["administrator", "editor"],
      },
    });
  });

  it("normalizes commentProviders capability flag", () => {
    const plugin = validatePluginContract(
      {
        id: "comments-provider-plugin",
        name: "Comments Provider",
        capabilities: { commentProviders: true },
      },
      "comments-provider-plugin",
    );
    expect(plugin).not.toBeNull();
    expect(plugin?.capabilities?.commentProviders).toBe(true);
  });

  it("normalizes aiProviders capability flag", () => {
    const plugin = validatePluginContract(
      {
        id: "ai-provider-plugin",
        name: "AI Provider",
        capabilities: { aiProviders: true },
      },
      "ai-provider-plugin",
    );
    expect(plugin).not.toBeNull();
    expect(plugin?.capabilities?.aiProviders).toBe(true);
  });

  it("preserves plugin developer metadata", () => {
    const plugin = validatePluginContract(
      {
        id: "example-plugin",
        name: "Example Plugin",
        developer: "Tooty CMS Core",
        website: "https://github.com/Joseffb/tootyCMS",
      },
      "example-plugin",
    );
    expect(plugin).not.toBeNull();
    expect(plugin?.developer).toBe("Tooty CMS Core");
    expect(plugin?.website).toBe("https://github.com/Joseffb/tootyCMS");
  });

  it("normalizes plugin and theme tags", () => {
    const plugin = validatePluginContract(
      {
        id: "tagged-plugin",
        name: "Tagged Plugin",
        tags: [" Utility ", "Auth", "custom tag", "auth"],
      },
      "tagged-plugin",
    );
    expect(plugin?.tags).toEqual(["utility", "auth", "custom-tag"]);

    const theme = validateThemeContract(
      {
        id: "tagged-theme",
        name: "Tagged Theme",
        tags: ["Theme", " Teety "],
      },
      "tagged-theme",
    );
    expect(theme?.tags).toEqual(["theme", "teety"]);
  });

  it("defaults plugin menu placement to settings and preserves settings menu metadata", () => {
    const plugin = validatePluginContract(
      {
        id: "menu-plugin",
        name: "Menu Plugin",
        menu: {
          label: "Workspace",
          path: "/app/plugins/menu-plugin",
          order: 25,
        },
        settingsMenu: {
          label: "Menu Plugin Settings",
          path: "/app/plugins/menu-plugin/settings",
          order: 30,
        },
      },
      "menu-plugin",
    );

    expect(plugin?.menuPlacement).toBe("settings");
    expect(plugin?.settingsMenu).toEqual({
      label: "Menu Plugin Settings",
      path: "/app/plugins/menu-plugin/settings",
      order: 30,
    });
  });

  it("accepts root and both plugin menu placements", () => {
    const rootPlugin = validatePluginContract(
      {
        id: "root-plugin",
        name: "Root Plugin",
        menuPlacement: "root",
      },
      "root-plugin",
    );
    const bothPlugin = validatePluginContract(
      {
        id: "both-plugin",
        name: "Both Plugin",
        menuPlacement: "both",
      },
      "both-plugin",
    );

    expect(rootPlugin?.menuPlacement).toBe("root");
    expect(bothPlugin?.menuPlacement).toBe("both");
  });

  it("preserves generic collection content model metadata for plugins", () => {
    const plugin = validatePluginContract(
      {
        id: "collection-plugin",
        name: "Collection Plugin",
        contentModel: {
          kind: "collection",
          parentTypeKey: "carousel",
          childTypeKey: "carousel-slide",
          childParentMetaKey: "carousel_id",
          childParentKeyMetaKey: "carousel_key",
          parentHandleMetaKey: "embed_key",
          workflowMetaKey: "workflow_state",
          orderMetaKey: "sort_order",
          mediaMetaKey: "media_id",
          ctaTextMetaKey: "cta_text",
          ctaUrlMetaKey: "cta_url",
          workflowStates: ["draft", "published", "archived"],
          workspaceLayout: "split",
          parentEditorFields: [
            {
              key: "story_label_map",
              label: "Story Label Map",
              type: "textarea",
              target: "meta",
              metaKey: "story_label_map",
              rows: 8,
            },
          ],
          childEditorFields: [
            {
              key: "chapter_key",
              label: "Chapter Key",
              type: "text",
              target: "meta",
              metaKey: "chapter_key",
            },
          ],
          childNestedItems: {
            metaKey: "story_experience_elements",
            singularLabel: "Artifact",
            pluralLabel: "Artifacts",
            fields: [
              {
                key: "title",
                label: "Title",
                type: "text",
              },
              {
                key: "mediaId",
                label: "Media",
                type: "media",
              },
            ],
          },
        },
      },
      "collection-plugin",
    );

    expect(plugin?.contentModel).toEqual({
      kind: "collection",
      parentTypeKey: "carousel",
      childTypeKey: "carousel-slide",
      childParentMetaKey: "carousel_id",
      childParentKeyMetaKey: "carousel_key",
      parentHandleMetaKey: "embed_key",
      workflowMetaKey: "workflow_state",
      orderMetaKey: "sort_order",
      mediaMetaKey: "media_id",
      ctaTextMetaKey: "cta_text",
      ctaUrlMetaKey: "cta_url",
      workflowStates: ["draft", "published", "archived"],
      workspaceLayout: "split",
      parentEditorFields: [
        {
          key: "story_label_map",
          label: "Story Label Map",
          type: "textarea",
          placeholder: "",
          helpText: "",
          rows: 8,
          target: "meta",
          metaKey: "story_label_map",
        },
      ],
      childEditorFields: [
        {
          key: "chapter_key",
          label: "Chapter Key",
          type: "text",
          placeholder: "",
          helpText: "",
          target: "meta",
          metaKey: "chapter_key",
        },
      ],
      childNestedItems: {
        metaKey: "story_experience_elements",
        singularLabel: "Artifact",
        pluralLabel: "Artifacts",
        fields: [
          {
            key: "title",
            label: "Title",
            type: "text",
            placeholder: "",
            helpText: "",
          },
          {
            key: "mediaId",
            label: "Media",
            type: "media",
            placeholder: "",
            helpText: "",
          },
        ],
      },
    });
  });

  it("preserves theme minimum core version field", () => {
    const theme = validateThemeContract(
      {
        id: "example-theme",
        name: "Example Theme",
        version: "0.1.0",
        minCoreVersion: "0.1.x",
      },
      "example-theme",
    );
    expect(theme).not.toBeNull();
    expect(theme?.minCoreVersion).toBe("0.1.x");
  });

  it("validates and preserves theme manifest query declarations", () => {
    const theme = validateThemeContract(
      {
        id: "query-theme",
        name: "Query Theme",
        queries: [
          {
            key: "featured_showcases",
            source: "content.list",
            scope: "site",
            route: "home",
            params: {
              dataDomain: "showcase",
              taxonomy: "category",
              withTerm: "featured",
              limit: 4,
            },
          },
        ],
      },
      "query-theme",
    );
    expect(theme).not.toBeNull();
    expect(theme?.queries).toHaveLength(1);
    expect(theme?.queries?.[0]?.key).toBe("featured_showcases");
    expect(theme?.queries?.[0]?.route).toBe("home");
  });

  it("preserves media settings field types for themes", () => {
    const theme = validateThemeContract(
      {
        id: "media-theme",
        name: "Media Theme",
        settingsFields: [
          {
            key: "hero_image",
            label: "Hero Image",
            type: "media",
          },
        ],
      },
      "media-theme",
    );

    expect(theme?.settingsFields?.[0]).toMatchObject({
      key: "hero_image",
      label: "Hero Image",
      type: "media",
    });
  });

  it("normalizes editor tab descriptors for editor-only plugins", () => {
    const plugin = validatePluginContract(
      {
        id: "story-plugin",
        name: "Story Plugin",
        editor: {
          tabs: [
            {
              id: "story",
              label: "Story",
              order: 320,
              supportsDomains: [" Post ", "page"],
              requiresCapability: "site.content.edit.any",
              sections: [
                {
                  id: "overview",
                  title: "Overview",
                  fragment: {
                    kind: "html",
                    html: "<p>Story settings</p>",
                  },
                  fields: [
                    {
                      key: "story_enabled",
                      label: "Enable Story",
                      type: "checkbox",
                    },
                    {
                      key: "chapter_style",
                      label: "Chapter Style",
                      type: "radio",
                      options: [
                        { label: "Cinematic", value: "cinematic" },
                      ],
                    },
                    {
                      key: "artifacts",
                      label: "Artifacts",
                      type: "repeater",
                      fields: [
                        {
                          key: "title",
                          label: "Title",
                          type: "text",
                        },
                        {
                          key: "media",
                          label: "Media",
                          type: "media",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      "story-plugin",
    );

    expect(plugin?.editor?.tabs).toEqual([
      {
        id: "story",
        label: "Story",
        order: 320,
        supportsDomains: ["post", "page"],
        requiresCapability: "site.content.edit.any",
        sections: [
          {
            id: "overview",
            title: "Overview",
            description: "",
            fragment: {
              kind: "html",
              html: "<p>Story settings</p>",
            },
            fields: [
              {
                key: "story_enabled",
                label: "Enable Story",
                type: "checkbox",
                placeholder: "",
                helpText: "",
                metaKey: undefined,
                fields: undefined,
              },
              {
                key: "chapter_style",
                label: "Chapter Style",
                type: "radio",
                placeholder: "",
                helpText: "",
                options: [{ label: "Cinematic", value: "cinematic" }],
                metaKey: undefined,
                fields: undefined,
              },
              {
                key: "artifacts",
                label: "Artifacts",
                type: "repeater",
                placeholder: "",
                helpText: "",
                metaKey: undefined,
                fields: [
                  {
                    key: "title",
                    label: "Title",
                    type: "text",
                    placeholder: "",
                    helpText: "",
                    metaKey: undefined,
                    fields: undefined,
                  },
                  {
                    key: "media",
                    label: "Media",
                    type: "media",
                    placeholder: "",
                    helpText: "",
                    metaKey: undefined,
                    fields: undefined,
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("normalizes text-tool editor fragments for governed AI suggestion tools", () => {
    const plugin = validatePluginContract(
      {
        id: "tooty-ai",
        name: "Tooty AI",
        editor: {
          tabs: [
            {
              id: "assist",
              label: "AI Assist",
              sections: [
                {
                  id: "rewrite",
                  title: "Rewrite Selection",
                  fragment: {
                    kind: "text-tool",
                    toolId: "rewrite",
                    title: "Rewrite Selection",
                    action: "rewrite",
                    source: "selection",
                    applyActions: ["replace_selection", "insert_below", "insert_below"],
                    instructionPlaceholder: "Tell the AI what to change.",
                    submitLabel: "Rewrite Selection",
                  },
                },
              ],
            },
          ],
        },
      },
      "tooty-ai",
    );

    expect(plugin?.editor?.tabs).toEqual([
      {
        id: "assist",
        label: "AI Assist",
        order: undefined,
        supportsDomains: undefined,
        requiresCapability: undefined,
        sections: [
          {
            id: "rewrite",
            title: "Rewrite Selection",
            description: "",
            fields: undefined,
            fragment: {
              kind: "text-tool",
              toolId: "rewrite",
              title: "Rewrite Selection",
              action: "rewrite",
              source: "selection",
              applyActions: ["replace_selection", "insert_below"],
              instructionPlaceholder: "Tell the AI what to change.",
              submitLabel: "Rewrite Selection",
            },
          },
        ],
      },
    ]);
  });
});
