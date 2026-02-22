import {
  AtSign,
  BadgeCheck,
  CheckSquare,
  Code,
  Facebook,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Linkedin,
  List,
  ListOrdered,
  Puzzle,
  Text,
  TextQuote,
  Youtube,
} from "lucide-react";
import { Command, createSuggestionItems, renderItems } from "novel";
import { createUploadFn } from "./image-upload";

type SlashCommandPostContext = {
  siteId: string | null;
};

let currentPost: SlashCommandPostContext | null = null;
let slashCommandApplied = false;

export function setCurrentPost(post: SlashCommandPostContext) {
  currentPost = post;
}

type RawSuggestion = {
  title: string;
  description: string;
  searchTerms?: string[];
  icon: JSX.Element;
  command: ({ editor, range }: any) => void;
};

type PluginSuggestionInput = {
  pluginId: string;
  pluginName: string;
  id: string;
  title: string;
  description?: string;
  content: string;
};

function normalizeSlashRange(editor: any, range: any) {
  if (!editor || !range) return range;
  const from = Math.max(1, Number(range.from || 1));
  const to = Number(range.to || from);
  const maybeSlash = editor.state.doc.textBetween(Math.max(1, from - 1), from, "", "");
  if (maybeSlash === "/") {
    return { from: Math.max(1, from - 1), to };
  }
  return { from, to };
}

function shouldPreserveSlashTrigger(editor: any, range: any) {
  if (!editor || !range) return true;
  const from = Math.max(1, Number(range.from || 1));
  const slash = editor.state.doc.textBetween(Math.max(1, from - 1), from, "", "");
  if (slash !== "/") return true;
  const prev = editor.state.doc.textBetween(Math.max(1, from - 2), Math.max(1, from - 1), "", "");
  return prev === "/" || prev === "'" || prev === "\"";
}

function stripSlashTrigger(editor: any, range: any) {
  if (!editor || !range) return;
  if (shouldPreserveSlashTrigger(editor, range)) return;
  const from = Math.max(1, Number(range.from || 1));
  editor
    .chain()
    .focus()
    .deleteRange({ from: Math.max(1, from - 1), to: from })
    .run();
}

function cleanupSlashPrompt(editor: any, range: any) {
  if (!editor || !range) return;
  const from = Math.max(1, Number(range.from || 1));
  const to = Math.max(from, Number(range.to || from));
  const within = editor.state.doc.textBetween(from, to, "", "");
  if (within.startsWith("/")) {
    editor.chain().focus().deleteRange({ from, to }).run();
    return;
  }
  const before = editor.state.doc.textBetween(Math.max(1, from - 1), from, "", "");
  if (before === "/") {
    editor.chain().focus().deleteRange({ from: Math.max(1, from - 1), to }).run();
  }
}

function renderSlashItems() {
  const renderer = renderItems();
  let stripped = false;
  let lastEditor: any = null;
  let lastRange: any = null;
  return {
    onStart: (props: any) => {
      lastEditor = props?.editor ?? lastEditor;
      lastRange = props?.range ?? lastRange;
      renderer.onStart?.(props);
      if (!stripped) {
        stripSlashTrigger(props?.editor, props?.range);
        stripped = true;
      }
    },
    onUpdate: (props: any) => {
      lastEditor = props?.editor ?? lastEditor;
      lastRange = props?.range ?? lastRange;
      renderer.onUpdate?.(props);
      if (!stripped) {
        stripSlashTrigger(props?.editor, props?.range);
        stripped = true;
      }
    },
    onKeyDown: (props: any) => {
      lastRange = props?.range ?? lastRange;
      if (props?.event?.key === "Escape") {
        cleanupSlashPrompt(lastEditor, lastRange);
      }
      return renderer.onKeyDown?.(props);
    },
    onExit: (props: any) => {
      if (!slashCommandApplied) {
        cleanupSlashPrompt(props?.editor ?? lastEditor, props?.range ?? lastRange);
      }
      slashCommandApplied = false;
      stripped = false;
      lastEditor = null;
      lastRange = null;
      renderer.onExit?.();
    },
  };
}

function wrapItems<T extends { command: (props: any) => void }>(items: T[]): T[] {
  return items.map((item) => {
    const original = item.command;
    return {
      ...item,
      command: (props: any) => {
        slashCommandApplied = true;
        const normalized = {
          ...props,
          range: normalizeSlashRange(props?.editor, props?.range),
        };
        original(normalized);
      },
    };
  });
}

const baseRawItems: RawSuggestion[] = [
  {
    title: "Text",
    description: "Just start typing with plain text.",
    searchTerms: ["p", "paragraph", "body"],
    icon: <Text size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleNode("paragraph", "paragraph").run();
    },
  },
  {
    title: "To-do List",
    description: "Track tasks with a to-do list.",
    searchTerms: ["todo", "task", "list", "check", "checkbox"],
    icon: <CheckSquare size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: "Heading 1",
    description: "Big section heading.",
    searchTerms: ["title", "big", "large"],
    icon: <Heading1 size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading.",
    searchTerms: ["subtitle", "medium"],
    icon: <Heading2 size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading.",
    searchTerms: ["subtitle", "small"],
    icon: <Heading3 size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run();
    },
  },
  {
    title: "Bullet List",
    description: "Create a simple bullet list.",
    searchTerms: ["unordered", "point"],
    icon: <List size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    description: "Create a list with numbering.",
    searchTerms: ["ordered"],
    icon: <ListOrdered size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Quote",
    description: "Capture a quote.",
    searchTerms: ["blockquote"],
    icon: <TextQuote size={18} />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleNode("paragraph", "paragraph").toggleBlockquote().run(),
  },
  {
    title: "Code",
    description: "Capture a code snippet.",
    searchTerms: ["codeblock"],
    icon: <Code size={18} />,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: "Image",
    description: "Upload an image from your computer.",
    searchTerms: ["photo", "picture", "media"],
    icon: <ImageIcon size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async () => {
        if (input.files?.length) {
          const file = input.files[0];
          const pos = editor.view.state.selection.from;
          const uploadFn = createUploadFn(currentPost?.siteId || "default", "post");
          uploadFn(file, editor.view, pos);
        }
      };
      input.click();
    },
  },
  {
    title: "Youtube",
    description: "Embed a Youtube video.",
    searchTerms: ["video", "youtube", "embed"],
    icon: <Youtube size={18} />,
    command: ({ editor, range }) => {
      const videoLink = prompt("Please enter Youtube Video Link");
      const ytregex = new RegExp(
        /^((?:https?:)?\/\/)?((?:www|m)\.)?((?:youtube\.com|youtu.be))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)(\S+)?$/,
      );

      if (videoLink && ytregex.test(videoLink)) {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setYoutubeVideo({
            src: videoLink,
          })
          .run();
      } else if (videoLink !== null) {
        alert("Please enter a correct Youtube Video Link");
      }
    },
  },
  {
    title: "X",
    description: "Embed an X post.",
    searchTerms: ["x", "twitter", "embed"],
    icon: <AtSign size={18} />,
    command: ({ editor, range }) => {
      const tweetLink = prompt("Please enter X post link");
      const tweetRegex = new RegExp(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\/([a-zA-Z0-9_]{1,15})(\/status\/(\d+))?(\/\S*)?$/);

      if (tweetLink && tweetRegex.test(tweetLink)) {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setTweet({
            src: tweetLink,
          })
          .run();
      } else if (tweetLink !== null) {
        alert("Please enter a correct X link");
      }
    },
  },
  {
    title: "Bluesky",
    description: "Insert a Bluesky post link.",
    searchTerms: ["bluesky", "social", "embed"],
    icon: <BadgeCheck size={18} />,
    command: ({ editor, range }) => {
      const link = prompt("Please enter Bluesky post link");
      const regex = /^https?:\/\/(www\.)?bsky\.app\/profile\/.+\/post\/.+$/;
      if (link && regex.test(link)) {
        editor.chain().focus().deleteRange(range).insertContent(`Bluesky: ${link}`).run();
      } else if (link !== null) {
        alert("Please enter a correct Bluesky post link");
      }
    },
  },
  {
    title: "LinkedIn",
    description: "Insert a LinkedIn post link.",
    searchTerms: ["linkedin", "social", "embed"],
    icon: <Linkedin size={18} />,
    command: ({ editor, range }) => {
      const link = prompt("Please enter LinkedIn post link");
      const regex = /^https?:\/\/(www\.)?linkedin\.com\/.+$/;
      if (link && regex.test(link)) {
        editor.chain().focus().deleteRange(range).insertContent(`LinkedIn: ${link}`).run();
      } else if (link !== null) {
        alert("Please enter a correct LinkedIn post link");
      }
    },
  },
  {
    title: "Facebook",
    description: "Insert a Facebook post link.",
    searchTerms: ["facebook", "social", "embed"],
    icon: <Facebook size={18} />,
    command: ({ editor, range }) => {
      const link = prompt("Please enter Facebook post link");
      const regex = /^https?:\/\/(www\.)?(facebook\.com|fb\.watch)\/.+$/;
      if (link && regex.test(link)) {
        editor.chain().focus().deleteRange(range).insertContent(`Facebook: ${link}`).run();
      } else if (link !== null) {
        alert("Please enter a correct Facebook post link");
      }
    },
  },
];

const baseSuggestionItems = wrapItems(createSuggestionItems(baseRawItems) as any[]);
let pluginSuggestionItems = wrapItems(createSuggestionItems([] as any[]) as any[]);

export function setPluginSuggestionItems(items: PluginSuggestionInput[]) {
  const pluginRaw: RawSuggestion[] = (items || []).map((item) => ({
    title: item.title,
    description: item.description || `Insert snippet from ${item.pluginName}`,
    searchTerms: ["plugin", item.pluginName.toLowerCase(), item.title.toLowerCase()],
    icon: <Puzzle size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent(item.content).run();
    },
  }));

  pluginSuggestionItems = wrapItems(createSuggestionItems(pluginRaw) as any[]);
}

export function getSuggestionItems() {
  return [...baseSuggestionItems, ...pluginSuggestionItems];
}

export const slashCommand = Command.configure({
  suggestion: {
    items: () => getSuggestionItems(),
    render: renderSlashItems,
  },
});
