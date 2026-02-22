import React from "react";
import Image from "next/image";

type MediaItem =
  | { type: "image"; src: string; alt: string }
  | { type: "video"; src: string }
  | { type: "social"; src: string };

function parseEditorMedia(postData: any): MediaItem[] {
  const raw = postData?.content;
  if (!raw || typeof raw !== "string") return [];

  let doc: any;
  try {
    doc = JSON.parse(raw);
  } catch {
    return [];
  }

  const media: MediaItem[] = [];
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
        if (!text) continue;
        if (/^https?:\/\//i.test(text)) {
          if (/youtube\.com|youtu\.be|vimeo\.com/i.test(text)) {
            media.push({ type: "video", src: text });
          } else if (/x\.com|twitter\.com|bsky\.app|linkedin\.com|facebook\.com/i.test(text)) {
            media.push({ type: "social", src: text });
          }
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

function toEmbedUrl(url: string) {
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

export default function GalleryLayout({ postData }: { postData: any }) {
  const media = parseEditorMedia(postData);

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-4">
        <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">{postData.title}</h2>
        {postData.description ? (
          <p className="mt-2 text-base text-stone-600 dark:text-stone-300">{postData.description}</p>
        ) : null}
      </header>

      {media.length === 0 ? (
        <p className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
          No media found in editor content yet. Add images or media links to build this gallery.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Media Carousel</p>
          <div className="overflow-x-auto pb-2 [scrollbar-width:thin]">
            <div className="flex snap-x snap-mandatory gap-4">
              {media.map((item, idx) => {
                if (item.type === "image") {
                  return (
                    <article
                      key={`${item.src}-${idx}`}
                      className="group relative aspect-video w-[min(88vw,44rem)] shrink-0 snap-center overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900"
                    >
                      <Image
                        src={item.src}
                        alt={item.alt}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 70vw, 44rem"
                      />
                    </article>
                  );
                }

                if (item.type === "video") {
                  const embed = toEmbedUrl(item.src);
                  return (
                    <article
                      key={`${item.src}-${idx}`}
                      className="w-[min(88vw,44rem)] shrink-0 snap-center overflow-hidden rounded-xl border border-stone-200 bg-white p-2 dark:border-stone-700 dark:bg-stone-900"
                    >
                      {embed ? (
                        <iframe
                          src={embed}
                          title={`Embedded video ${idx + 1}`}
                          className="aspect-video w-full rounded-lg"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      ) : (
                        <a href={item.src} className="text-sm text-orange-700 underline dark:text-orange-400" target="_blank" rel="noreferrer">
                          Open video
                        </a>
                      )}
                    </article>
                  );
                }

                return (
                  <a
                    key={`${item.src}-${idx}`}
                    href={item.src}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-[240px] w-[min(88vw,44rem)] shrink-0 snap-center items-center justify-center rounded-xl border border-stone-200 bg-white p-4 text-center text-sm font-medium text-stone-700 hover:text-orange-700 hover:underline dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:text-orange-400"
                  >
                    Open social post
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
