import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createKernelForRequest, listPluginsWithState } from "@/lib/plugin-runtime";
import { userCan } from "@/lib/authorization";
import { filterTabsForDomain, sortEditorPluginTabs } from "@/lib/editor-plugin-tabs";
import type { PluginEditorTab } from "@/lib/extension-contracts";

type EditorFooterPanel = {
  id?: string;
  title?: string;
  content?: string;
};

type EditorTabResponse = PluginEditorTab & {
  pluginId: string;
  pluginName: string;
};

function normalizeEditorTab(tab: EditorTabResponse | null | undefined): EditorTabResponse | null {
  if (!tab) return null;
  const id = String(tab.id || "").trim();
  const label = String(tab.label || "").trim();
  if (!id || !label || !Array.isArray(tab.sections) || tab.sections.length === 0) return null;
  return {
    ...tab,
    id,
    label,
    pluginId: String(tab.pluginId || "").trim(),
    pluginName: String(tab.pluginName || "").trim(),
    sections: tab.sections,
  };
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId")?.trim() || "";
  const postId = url.searchParams.get("postId")?.trim() || "";
  const dataDomainKey = url.searchParams.get("dataDomainKey")?.trim().toLowerCase() || "";

  const plugins = await listPluginsWithState();
  const editorPlugins = plugins
    .filter((plugin: any) => plugin.enabled)
    .map((plugin: any) => ({
      id: plugin.id,
      name: plugin.name,
      snippets: Array.isArray((plugin as any).editor?.snippets) ? (plugin as any).editor.snippets : [],
    }))
    .filter((plugin: any) => plugin.snippets.length > 0);
  const manifestTabs = plugins
    .filter((plugin: any) => plugin.enabled)
    .flatMap((plugin: any) =>
      filterTabsForDomain(Array.isArray(plugin?.editor?.tabs) ? plugin.editor.tabs : [], dataDomainKey).map((tab) => ({
        ...tab,
        pluginId: String(plugin.id || ""),
        pluginName: String(plugin.name || ""),
      })),
    );

  const kernel = await createKernelForRequest(siteId || undefined);
  const tabsRaw = await kernel.applyFilters<EditorTabResponse[]>(
    "admin:editor:tabs",
    manifestTabs,
    {
      siteId: siteId || null,
      postId: postId || null,
      dataDomainKey: dataDomainKey || null,
      userId: session.user.id,
    },
  );
  const footerPanelsRaw = await kernel.applyFilters<EditorFooterPanel[]>(
    "admin:editor:footer-panels",
    [],
    {
      siteId: siteId || null,
      postId: postId || null,
      userId: session.user.id,
    },
  );
  const footerPanels = Array.isArray(footerPanelsRaw)
    ? footerPanelsRaw
        .map((panel) => ({
          id: String(panel?.id || ""),
          title: String(panel?.title || ""),
          content: String(panel?.content || ""),
        }))
        .filter((panel) => panel.id && panel.content)
    : [];
  const tabs = sortEditorPluginTabs(
    (
      await Promise.all(
        (Array.isArray(tabsRaw) ? tabsRaw : [])
          .map((tab) => normalizeEditorTab(tab))
          .filter((tab): tab is EditorTabResponse => Boolean(tab))
          .filter((tab) => filterTabsForDomain([tab], dataDomainKey).length > 0)
          .map(async (tab) => {
            if (!tab.requiresCapability) return tab;
            if (!siteId) return null;
            const allowed = await userCan(tab.requiresCapability, session.user.id, { siteId });
            return allowed ? tab : null;
          }),
      )
    ).filter((tab): tab is EditorTabResponse => Boolean(tab)),
  );

  return NextResponse.json({ plugins: editorPlugins, tabs, footerPanels });
}
