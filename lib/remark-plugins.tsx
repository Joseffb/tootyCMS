import Link from "next/link";
import { visit } from "unist-util-visit";
import { ReactNode } from "react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DrizzleClient } from "./db";

export function replaceLinks({
  href,
  children,
}: {
  href?: string;
  children: ReactNode;
}) {
  // this is technically not a remark plugin but it
  // replaces internal links with <Link /> component
  // and external links with <a target="_blank" />
  return href?.startsWith("/") || href === "" ? (
    <Link href={href} className="cursor-pointer">
      {children}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  );
}

export function replaceTweets() {
  return (tree: any) =>
    new Promise<void>(async (resolve, reject) => {
      const nodesToChange = new Array();

      visit(tree, "link", (node: any) => {
        if (
          node.url.match(
            /https?:\/\/twitter\.com\/(?:#!\/)?(\w+)\/status(?:es)?\/(\d+)([^\?])(\?.*)?/g,
          )
        ) {
          nodesToChange.push({
            node,
          });
        }
      });
      for (const { node } of nodesToChange) {
        try {
          const regex = /\/status\/(\d+)/gm;
          const matches = regex.exec(node.url);

          if (!matches) throw new Error(`Failed to get tweet: ${node}`);

          const id = matches[1];

          node.type = "mdxJsxFlowElement";
          node.name = "Tweet";
          node.attributes = [
            {
              type: "mdxJsxAttribute",
              name: "id",
              value: id,
            },
          ];
        } catch (e) {
          console.log("ERROR", e);
          return reject(e);
        }
      }

      resolve();
    });
}

const STARTER_CONTENT_DIR = path.join(process.cwd(), "public", "docs");

type ExampleDoc = {
  key: string;
  title: string;
  markdown: string;
};

const FALLBACK_EXAMPLE_DOCS: Record<string, string> = {
  welcome: "# Welcome\n\nStarter content is loaded from markdown files.",
  about: "# About\n\nUpdate this file in public/docs/about.md.",
  "terms-of-service": "# Terms of Service\n\nUpdate this file in public/docs/terms-of-service.md.",
  "privacy-policy": "# Privacy Policy\n\nUpdate this file in public/docs/privacy-policy.md.",
};

export function replaceExamples(drizzle: DrizzleClient) {
  return (tree: any) =>
    new Promise<void>(async (resolve, reject) => {
      const nodesToChange = new Array();

      visit(tree, "mdxJsxFlowElement", (node: any) => {
        if (node.name == "Examples") {
          nodesToChange.push({
            node,
          });
        }
      });
      for (const { node } of nodesToChange) {
        try {
          const data = await getExamples(node, drizzle);
          node.attributes = [
            {
              type: "mdxJsxAttribute",
              name: "data",
              value: data,
            },
          ];
        } catch (e) {
          return reject(e);
        }
      }

      resolve();
    });
}

async function getExamples(node: any, drizzle: DrizzleClient) {
  void drizzle;
  const names = String(node?.attributes?.[0]?.value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const data: ExampleDoc[] = [];

  for (const name of names) {
    const key = name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!key) continue;
    const filename = key.endsWith(".md") ? key : `${key}.md`;
    const filePath = path.join(STARTER_CONTENT_DIR, filename);
    let markdown = FALLBACK_EXAMPLE_DOCS[key] || "";
    try {
      const loaded = await readFile(filePath, "utf8");
      if (loaded.trim().length > 0) markdown = loaded.trim();
    } catch {}
    data.push({
      key,
      title: key.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
      markdown,
    });
  }

  return JSON.stringify(data);
}
