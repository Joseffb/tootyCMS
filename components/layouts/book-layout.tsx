import React from "react";
import MDX from "../mdx";

export default function BookLayout({ postData }: { postData: any }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12 bg-white dark:bg-black shadow-lg rounded-md border border-stone-200 dark:border-stone-700">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-serif font-bold text-gray-900 dark:text-white">
          {postData.title}
        </h1>
        {postData.subtitle && (
          <p className="mt-2 text-lg text-stone-500 dark:text-stone-400 italic">
            {postData.subtitle}
          </p>
        )}
      </header>

      {/* MDX Content Only */}
      <MDX source={postData.mdxSource} />
    </div>
  );
}