import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getPluginById } from "@/lib/plugins";
import { getPluginsDirs } from "@/lib/extension-paths";

const mimeByExt: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

async function serveFile(filePath: string) {
  const content = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeByExt[ext] || "application/octet-stream";
  return new NextResponse(content, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

async function resolvePluginRoot(pluginId: string) {
  const plugin = await getPluginById(pluginId);
  const sourceDir = (plugin as (typeof plugin & { sourceDir?: string }) | null)?.sourceDir;
  const base = sourceDir || getPluginsDirs()[0] || path.join(process.cwd(), "plugins");
  return path.join(base, pluginId);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pluginId: string; assetPath: string[] }> },
) {
  const { pluginId, assetPath } = await params;
  const safePluginId = safeSegment(pluginId);
  const cleanParts = (assetPath || []).map(safeSegment).filter(Boolean);
  if (!safePluginId || cleanParts.length === 0) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const pluginRoot = await resolvePluginRoot(safePluginId);
  const roots = ["assets", "public"];
  for (const root of roots) {
    const rootDir = path.join(pluginRoot, root);
    const filePath = path.join(rootDir, ...cleanParts);
    if (!filePath.startsWith(rootDir)) continue;
    try {
      return await serveFile(filePath);
    } catch {
      continue;
    }
  }

  return new NextResponse("Not Found", { status: 404 });
}
