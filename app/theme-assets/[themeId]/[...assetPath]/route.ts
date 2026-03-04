import { NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { getThemesDirs } from "@/lib/extension-paths";
import { getAvailableThemes } from "@/lib/themes";
import { getThemeAssetCacheControlHeader } from "@/lib/theme-dev-mode";

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
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

function parseRangeHeader(rangeHeader: string, size: number) {
  const trimmed = rangeHeader.trim();
  if (!trimmed.startsWith("bytes=")) {
    return null;
  }

  const [startRaw, endRaw] = trimmed.slice("bytes=".length).split("-", 2);
  if (startRaw === undefined || endRaw === undefined) {
    return null;
  }

  const startText = startRaw.trim();
  const endText = endRaw.trim();

  if (!startText && !endText) {
    return null;
  }

  let start = 0;
  let end = size - 1;

  if (!startText) {
    const suffixLength = Number.parseInt(endText, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(size - suffixLength, 0);
  } else {
    const parsedStart = Number.parseInt(startText, 10);
    if (!Number.isFinite(parsedStart) || parsedStart < 0) {
      return null;
    }
    start = parsedStart;
    if (endText) {
      const parsedEnd = Number.parseInt(endText, 10);
      if (!Number.isFinite(parsedEnd) || parsedEnd < start) {
        return null;
      }
      end = parsedEnd;
    }
  }

  if (start >= size) {
    return null;
  }

  end = Math.min(end, size - 1);

  return { start, end };
}

async function serveFile(filePath: string, rangeHeader: string | null) {
  const info = await stat(filePath);
  if (!info.isFile()) {
    throw new Error("not-a-file");
  }

  const size = info.size;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeByExt[ext] || "application/octet-stream";
  const cacheControl = getThemeAssetCacheControlHeader();
  const streamHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "Accept-Ranges": "bytes",
  };

  if (!rangeHeader) {
    streamHeaders["Content-Length"] = String(size);
    const stream = createReadStream(filePath);
    return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: streamHeaders,
    });
  }

  const range = parseRangeHeader(rangeHeader, size);
  if (!range) {
    return new NextResponse("Requested Range Not Satisfiable", {
      status: 416,
      headers: {
        ...streamHeaders,
        "Content-Range": `bytes */${size}`,
      },
    });
  }

  const contentLength = range.end - range.start + 1;
  const stream = createReadStream(filePath, { start: range.start, end: range.end });
  return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: 206,
    headers: {
      ...streamHeaders,
      "Content-Length": String(contentLength),
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
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
  req: Request,
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
        return await serveFile(filePath, req.headers.get("range"));
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
      return await serveFile(filePath, req.headers.get("range"));
    } catch {
      continue;
    }
  }

  return new NextResponse("Not Found", { status: 404 });
}
