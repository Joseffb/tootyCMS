// lib/convertTiptapJSON.tsx
import {
  MarkdownSerializer,
  MarkdownSerializerState,
} from "prosemirror-markdown";
import {
  Node as ProseMirrorNode,
  Schema,
  MarkSpec,
} from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";

/**
 * TipTap → ProseMirror node‑type mapper.
 * TipTap emits camelCase names (codeBlock, bulletList, …)
 * whereas ProseMirror prefers snake_case (code_block, bullet_list, …).
 * We normalise recursively so the incoming JSON matches our schema.
 */
function normalizeNodeTypes(json: any): any {
  if (!json || typeof json !== "object") return json;
  if (Array.isArray(json)) return json.map(normalizeNodeTypes);

  const typeMap: Record<string, string> = {
    codeBlock: "code_block",
    bulletList: "bullet_list",
    orderedList: "ordered_list",
    listItem: "list_item",
    hardBreak: "hard_break",
    horizontalRule: "horizontal_rule",
    textStyle: "textStyle", // passthrough (same name in both)
  };

  const updated: any = {};
  for (const key in json) {
    if (key === "type" && typeMap[json[key]]) {
      updated[key] = typeMap[json[key]];
    } else {
      updated[key] = normalizeNodeTypes(json[key]);
    }
  }
  return updated;
}

// ────────────────────────────────────────────────────────────
//  SCHEMA SETUP
// ────────────────────────────────────────────────────────────

// Extend the basic schema with list support
let nodes = addListNodes(basicSchema.spec.nodes, "paragraph block*", "block");

// Ensure additional nodes exist (code_block, list_item, etc.)
nodes = nodes.append({
  code_block: {
    content: "text*",
    marks: "",
    group: "block",
    code: true,
    defining: true,
    parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
    toDOM: () => ["pre", ["code", 0]],
  },
  codeBlock: { ...nodes.get("code_block") }, // alias for incoming camelCase

  list_item: {
    content: "paragraph block*",
    defining: true,
    parseDOM: [{ tag: "li" }],
    toDOM: () => ["li", 0],
  },
  listItem: { ...nodes.get("list_item") }, // alias

  horizontal_rule: {
    group: "block",
    parseDOM: [{ tag: "hr" }],
    toDOM: () => ["hr"],
  },
  hard_break: {
    inline: true,
    group: "inline",
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM: () => ["br"],
  },
});

// Extend image node with additional attrs
nodes = nodes.update("image", {
  ...nodes.get("image"),
  attrs: {
    src: {},
    alt: { default: null },
    title: { default: null },
    width: { default: null },
    height: { default: null },
    alignment: { default: null },
    fit: { default: null },
  },
});

// Custom marks
const customMarks = basicSchema.spec.marks.append({
  bold: {
    parseDOM: [{ tag: "strong" }, { style: "font-weight=bold" }],
    toDOM: () => ["strong", 0],
  } satisfies MarkSpec,
  italic: {
    parseDOM: [{ tag: "em" }, { style: "font-style=italic" }],
    toDOM: () => ["em", 0],
  } satisfies MarkSpec,
  underline: {
    parseDOM: [{ tag: "u" }, { style: "text-decoration=underline" }],
    toDOM: () => ["u", 0],
  } satisfies MarkSpec,
  color: {
    attrs: { color: {} },
    parseDOM: [
      {
        style: "color",
        getAttrs: (value) => ({ color: value }),
      },
    ],
    toDOM: (mark) => ["span", { style: `color: ${mark.attrs.color}` }, 0],
  } satisfies MarkSpec,
});

export const customSchema = new Schema({ nodes, marks: customMarks });

// ────────────────────────────────────────────────────────────
//  SERIALISER SETUP
// ────────────────────────────────────────────────────────────

const nodeSerializers = {
  doc(state: MarkdownSerializerState, node: ProseMirrorNode) {
    state.renderContent(node);
  },
  paragraph(state: MarkdownSerializerState, node: ProseMirrorNode) {
    state.renderInline(node);
    state.closeBlock(node);
  },
  heading(state: MarkdownSerializerState, node: ProseMirrorNode) {
    state.write("#".repeat(node.attrs.level) + " ");
    state.renderInline(node);
    state.closeBlock(node);
  },
  blockquote(state: MarkdownSerializerState, node: ProseMirrorNode) {
    state.wrapBlock("> ", null, node, () => state.renderContent(node));
  },
  code_block(state: MarkdownSerializerState, node: ProseMirrorNode) {
    state.write("```\n");
    state.text(node.textContent, false);
    state.write("\n```");
    state.closeBlock(node);
  },
  hard_break(state: MarkdownSerializerState) {
    state.write("  \n");
  },
  horizontal_rule(state: MarkdownSerializerState, node: ProseMirrorNode) {
    state.write("---");
    state.closeBlock(node);
  },
  bullet_list(state: MarkdownSerializerState, node: ProseMirrorNode) {
    state.renderList(node, "  ", () => "* ");
  },
  ordered_list(state: MarkdownSerializerState, node: ProseMirrorNode) {
    const start = node.attrs.order || 1;
    state.renderList(node, "  ", (i) => `${start + i}. `);
  },
  list_item(state: MarkdownSerializerState, node: ProseMirrorNode) {
    state.renderContent(node);
  },
  image(state: MarkdownSerializerState, node: ProseMirrorNode) {
    const { src, alt = "", title } = node.attrs;
    if (!src) return;
    const escAlt = String(alt).replace(/\]/g, "\\]");
    const escTitle = title ? String(title).replace(/"/g, '\\"') : "";
    state.ensureNewLine();
    state.write(`![${escAlt}](${src}${escTitle ? ` "${escTitle}"` : ""})`);
    state.closeBlock(node);
  },
  text(state: MarkdownSerializerState, node: ProseMirrorNode) {
    state.text(node.text || "");
  },
};

const markSerializers = {
  bold: { open: "**", close: "**" },
  strong: { open: "**", close: "**" },
  italic: { open: "_", close: "_" },
  em: { open: "_", close: "_" },
  underline: { open: "<u>", close: "</u>" },
  code: { open: "`", close: "`" },
  link: {
    open: () => "[",
    close: (_: any, mark: any) => `](${mark.attrs.href || "#"})`,
  },
  color: {
    open: (_: any, mark: any) => `<span style=\"color: ${mark.attrs.color}\">`,
    close: () => "</span>",
  },
  textStyle: { open: "", close: "" },
};

export const serializer = new MarkdownSerializer(nodeSerializers, markSerializers);

// ────────────────────────────────────────────────────────────
//  CONVERTER
// ────────────────────────────────────────────────────────────

export function convertTiptapJSONToMarkdown(jsonContent: any): string {
  try {
    if (!jsonContent || jsonContent.type !== "doc") {
      console.error("🚨 Invalid TipTap JSON:", jsonContent);
      return "";
    }

    // Normalise node names before feeding into ProseMirror
    const normalizedJSON = normalizeNodeTypes(jsonContent);
    const doc = ProseMirrorNode.fromJSON(customSchema, normalizedJSON);
    return serializer.serialize(doc);
  } catch (error) {
    console.error("🔥 Error converting TipTap JSON to Markdown:", error);
    return "";
  }
}
