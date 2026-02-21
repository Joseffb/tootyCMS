export type GalleryMediaItem =
  | { type: "image"; src: string; alt: string }
  | { type: "video"; src: string; embedSrc: string | null }
  | { type: "social"; src: string };

export function toEmbedUrl(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace("/", "");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname.includes("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseGalleryMediaFromContent(rawContent: unknown): GalleryMediaItem[] {
  if (!rawContent || typeof rawContent !== "string") return [];

  let doc: any;
  try {
    doc = JSON.parse(rawContent);
  } catch {
    return [];
  }

  const media: GalleryMediaItem[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;

    if (node.type === "image" && node.attrs?.src) {
      media.push({
        type: "image",
        src: String(node.attrs.src),
        alt: String(node.attrs.alt || "Gallery image"),
      });
    }

    if (node.type === "paragraph" && Array.isArray(node.content)) {
      for (const child of node.content) {
        const text = typeof child?.text === "string" ? child.text.trim() : "";
        if (!text || !/^https?:\/\//i.test(text)) continue;

        if (/youtube\.com|youtu\.be|vimeo\.com/i.test(text)) {
          media.push({ type: "video", src: text, embedSrc: toEmbedUrl(text) });
        } else if (/x\.com|twitter\.com|bsky\.app|linkedin\.com|facebook\.com/i.test(text)) {
          media.push({ type: "social", src: text });
        }
      }
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
    }
  };

  visit(doc);
  return media;
}
