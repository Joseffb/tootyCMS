import { Button } from "@/components/tailwind/ui/button";
import { cn } from "@/lib/utils";
import { BoldIcon, CodeIcon, ItalicIcon, StrikethroughIcon, UnderlineIcon } from "lucide-react";
import { EditorBubbleItem, useEditor } from "novel";
import type { SelectorItem } from "./node-selector";

export const TextButtons = () => {
  const { editor } = useEditor();

  // Early return if editor is not available
  if (!editor) return null;

  const items: SelectorItem[] = [
    {
      name: "bold",
      isActive: () => editor?.isActive("bold"),
      command: () => editor?.chain().focus().toggleBold().run(),
      icon: BoldIcon,
    },
    {
      name: "italic",
      isActive: () => editor?.isActive("italic"),
      command: () => editor?.chain().focus().toggleItalic().run(),
      icon: ItalicIcon,
    },
    {
      name: "underline",
      isActive: () => editor?.isActive("underline"),
      command: () => editor?.chain().focus().toggleUnderline().run(),
      icon: UnderlineIcon,
    },
    {
      name: "strike",
      isActive: () => editor?.isActive("strike"),
      command: () => editor?.chain().focus().toggleStrike().run(),
      icon: StrikethroughIcon,
    },
    {
      name: "code",
      isActive: () => editor?.isActive("code"),
      command: () => editor?.chain().focus().toggleCode().run(),
      icon: CodeIcon,
    },
  ];

  return (
    <div className="flex">
      {items.map((item) => (
        <EditorBubbleItem
          key={item.name}
          onSelect={() => {
            // Safely call the command only when the editor is not null
            if (editor) {
              item.command(editor);
            }
          }}
        >
          <Button size="sm" className="rounded-none" variant="ghost" type="button">
            <item.icon
              className={cn("h-4 w-4", {
                "text-blue-500": editor?.isActive(item.name),
              })}
            />
          </Button>
        </EditorBubbleItem>
      ))}
    </div>
  );
};