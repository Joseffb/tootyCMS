function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderText(text: string, marks: any[] = []) {
  let out = escapeHtml(text || "");
  for (const mark of marks) {
    const type = mark?.type;
    if (type === "bold" || type === "strong") out = `<strong>${out}</strong>`;
    else if (type === "italic" || type === "em") out = `<em>${out}</em>`;
    else if (type === "code") out = `<code>${out}</code>`;
    else if (type === "link") {
      const href = typeof mark?.attrs?.href === "string" ? mark.attrs.href : "#";
      out = `<a href="${escapeHtml(href)}">${out}</a>`;
    }
  }
  return out;
}

function renderNodes(nodes: any[] = []): string {
  return nodes.map((node) => renderNode(node)).join("");
}

function renderParagraph(content: any[] = []): string {
  const segments: any[][] = [[]];
  for (const child of content) {
    const type = child?.type;
    if (type === "hardBreak" || type === "hard_break") {
      segments.push([]);
      continue;
    }
    segments[segments.length - 1].push(child);
  }

  const html = segments
    .map((segment) => renderNodes(segment).trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => `<p>${segment}</p>`)
    .join("");

  return html || "<p></p>";
}

function renderList(node: any, tag: "ul" | "ol") {
  const items = Array.isArray(node?.content) ? node.content : [];
  return `<${tag}>${items.map((item: any) => renderNode(item)).join("")}</${tag}>`;
}

function renderNode(node: any): string {
  if (!node || typeof node !== "object") return "";
  const type = node.type;
  const content = Array.isArray(node.content) ? node.content : [];

  if (type === "text") {
    return renderText(typeof node.text === "string" ? node.text : "", Array.isArray(node.marks) ? node.marks : []);
  }

  if (type === "doc") return renderNodes(content);
  if (type === "paragraph") return renderParagraph(content);
  if (type === "heading") {
    const levelRaw = Number(node?.attrs?.level || 2);
    const level = Number.isFinite(levelRaw) && levelRaw >= 1 && levelRaw <= 6 ? levelRaw : 2;
    return `<h${level}>${renderNodes(content)}</h${level}>`;
  }
  if (type === "bulletList" || type === "bullet_list") return renderList(node, "ul");
  if (type === "orderedList" || type === "ordered_list") return renderList(node, "ol");
  if (type === "listItem" || type === "list_item") return `<li>${renderNodes(content)}</li>`;
  if (type === "blockquote") return `<blockquote>${renderNodes(content)}</blockquote>`;
  if (type === "codeBlock" || type === "code_block") return `<pre><code>${escapeHtml(content.map((c: any) => c?.text || "").join(""))}</code></pre>`;
  if (type === "horizontalRule" || type === "horizontal_rule") return "<hr />";
  if (type === "hardBreak" || type === "hard_break") return "<br />";
  if (type === "image") {
    const src = typeof node?.attrs?.src === "string" ? node.attrs.src : "";
    const alt = typeof node?.attrs?.alt === "string" ? node.attrs.alt : "";
    if (!src) return "";
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`;
  }

  return renderNodes(content);
}

export function toThemePostHtml(rawContent: unknown): string {
  if (typeof rawContent !== "string" || !rawContent.trim()) return "";
  const trimmed = rawContent.trim();

  if (trimmed.startsWith("<")) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && parsed.type === "doc") {
      return renderNode(parsed);
    }
  } catch {
    // fall through
  }

  return `<p>${escapeHtml(trimmed).replace(/\n/g, "<br />")}</p>`;
}
