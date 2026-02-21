// components/editor-client.tsx
"use client";

import dynamic from "next/dynamic";
import { EditorRoot, EditorContent, type JSONContent } from "novel";
import { defaultExtensions } from "./extensions/editor-extensions";

interface EditorClientProps {
  content: JSONContent;
  setContent: (content: JSONContent) => void;
}

function EditorClientComponent({ content, setContent }: EditorClientProps) {
  return (
    <EditorRoot>
      <EditorContent
        initialContent={content}
        onUpdate={({ editor }) => {
          const updated = editor.getJSON();
          setContent(updated);
        }}
        extensions={defaultExtensions}
      />
    </EditorRoot>
  );
}

const EditorClient = dynamic(() => Promise.resolve(EditorClientComponent), {
  ssr: false,
});

export default EditorClient;