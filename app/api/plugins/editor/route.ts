import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listPluginsWithState } from "@/lib/plugin-runtime";

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plugins = await listPluginsWithState();
  const editorPlugins = plugins
    .filter((plugin: any) => plugin.enabled)
    .map((plugin: any) => ({
      id: plugin.id,
      name: plugin.name,
      snippets: Array.isArray((plugin as any).editor?.snippets) ? (plugin as any).editor.snippets : [],
    }))
    .filter((plugin: any) => plugin.snippets.length > 0);

  return NextResponse.json({ plugins: editorPlugins });
}
