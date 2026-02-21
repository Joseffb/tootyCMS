import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ImageComponent from "@/components/editor/image-component";
import { UploadImagesPlugin } from "novel"; // You'll build this component next

export const TiptapImageWithMenu = Node.create({
  name: "image",

  group: "block",
  draggable: true,
  selectable: true,
  atom: true,
  addProseMirrorPlugins() {
    return [
      UploadImagesPlugin({
        imageClass: "rounded-lg border border-muted",
      }),
    ];
  },
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      height: { default: null },
      alignment: { default: "center" }, // block | left | center | right
      fit: { default: "cover" }, // contain | cover | none
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-type='custom-image']",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "figure",
      mergeAttributes(HTMLAttributes, {
        "data-type": "custom-image",
        style: `text-align: ${HTMLAttributes.alignment};`,
      }),
      [
        "img",
        mergeAttributes(HTMLAttributes, {
          style: `object-fit: ${HTMLAttributes.fit}; width: ${HTMLAttributes.width || 'auto'}; height: ${HTMLAttributes.height || 'auto'};`,
        }),
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageComponent);
  },
});