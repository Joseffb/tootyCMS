import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createKernelForRequest, listPluginsWithState } from "@/lib/plugin-runtime";

type EditorFooterPanel = {
  id?: string;
  title?: string;
  content?: string;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId")?.trim() || "";
  const postId = url.searchParams.get("postId")?.trim() || "";

  const plugins = await listPluginsWithState();
  const editorPlugins = plugins
    .filter((plugin: any) => plugin.enabled)
    .map((plugin: any) => ({
      id: plugin.id,
      name: plugin.name,
      snippets: Array.isArray((plugin as any).editor?.snippets) ? (plugin as any).editor.snippets : [],
    }))
    .filter((plugin: any) => plugin.snippets.length > 0);

  const kernel = await createKernelForRequest(siteId || undefined);
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

  return NextResponse.json({ plugins: editorPlugins, footerPanels });
}
