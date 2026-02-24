import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getThemesDirs } from "@/lib/extension-paths";
import { getAvailableThemes } from "@/lib/themes";

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

async function resolveThemeRoot(themeId: string) {
  const themes = await getAvailableThemes();
  const matched = themes.find((theme) => theme.id === themeId) as (typeof themes[number] & { sourceDir?: string }) | undefined;
  if (matched?.sourceDir) {
    return path.join(matched.sourceDir, themeId);
  }
  const themeDirs = getThemesDirs();
  return path.join(themeDirs[0] || path.join(process.cwd(), "themes"), themeId);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ themeId: string; assetPath: string[] }> },
) {
  const { themeId, assetPath } = await params;
  const safeThemeId = safeSegment(themeId);
  const cleanParts = (assetPath || []).map(safeSegment).filter(Boolean);

  if (!safeThemeId || cleanParts.length === 0) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const themeRoot = await resolveThemeRoot(safeThemeId);

  if (cleanParts.length === 1 && cleanParts[0] === "thumbnail.png") {
    const filePath = path.join(themeRoot, "thumbnail.png");
    if (filePath.startsWith(themeRoot)) {
      try {
        return await serveFile(filePath);
      } catch {
        return new NextResponse("Not Found", { status: 404 });
      }
    }
  }

  const roots = ["assets", "public"];
  for (const root of roots) {
    const rootDir = path.join(themeRoot, root);
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
