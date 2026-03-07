export function tiptapParagraph(text: string) {
  return JSON.stringify({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: String(text || "") }],
      },
    ],
  });
}
