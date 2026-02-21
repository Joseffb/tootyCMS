// components/mdx.tsx
"use client";

import { MDXRemote } from "next-mdx-remote";
import type { MDXRemoteSerializeResult } from "next-mdx-remote";
import { Tweet } from "react-tweet";
import BlurImage from "@/components/blur-image";
import styles from "./mdx.module.css";

const components = {
  a: (props: React.ComponentProps<"a">) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
  BlurImage,
  Tweet,
};

interface MDXProps {
  source: MDXRemoteSerializeResult;
}

export default function MDX({ source }: MDXProps) {
  console.log("here in the client.", source );
  return (
    <article
      className={`prose-md prose prose-stone m-auto w-11/12 sm:prose-lg dark:prose-invert sm:w-3/4 ${styles.root}`}
    >
      <MDXRemote {...source} components={components} />
    </article>
  );
}