"use client";

import { useMemo, useState } from "react";
import type { CommentProviderWritingOptionState } from "@/lib/comments-spine";

type Props = {
  commentsPluginEnabled: boolean;
  defaultEnableComments: boolean;
  options: CommentProviderWritingOptionState[];
};

export default function CommentProviderOptions({
  commentsPluginEnabled,
  defaultEnableComments,
  options,
}: Props) {
  const [enableComments, setEnableComments] = useState(defaultEnableComments);
  const [values, setValues] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const option of options) initial[option.key] = Boolean(option.value);
    return initial;
  });

  const optionByKey = useMemo(() => {
    const entries: Record<string, CommentProviderWritingOptionState> = {};
    for (const option of options) entries[option.key] = option;
    return entries;
  }, [options]);

  const tree = useMemo(() => {
    const childrenByParent: Record<string, CommentProviderWritingOptionState[]> = {};
    const roots: CommentProviderWritingOptionState[] = [];

    for (const option of options) {
      const parentKey = option.dependsOn?.key;
      if (!parentKey || !optionByKey[parentKey]) {
        roots.push(option);
        continue;
      }
      if (!childrenByParent[parentKey]) childrenByParent[parentKey] = [];
      childrenByParent[parentKey].push(option);
    }

    return { roots, childrenByParent };
  }, [optionByKey, options]);

  const providerHeading = useMemo(() => {
    const raw = String(options[0]?.providerId || "").trim();
    if (!raw) return "Comment Provider Options";
    const normalized = raw.split(":").pop() || raw;
    const name = normalized
      .replace(/[_-]+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
    return `${name || "Comment Provider"} Options`;
  }, [options]);

  const isOptionVisible = (option: CommentProviderWritingOptionState): boolean => {
    const dependsOn = option.dependsOn;
    if (!dependsOn?.key) return true;
    const parent = optionByKey[dependsOn.key];
    if (!parent) return true;
    const parentVisible = isOptionVisible(parent);
    if (!parentVisible) return false;
    return Boolean(values[dependsOn.key]) === Boolean(dependsOn.value);
  };

  const renderOptionTree = (option: CommentProviderWritingOptionState) => {
    const children = tree.childrenByParent[option.key] || [];
    const visible = isOptionVisible(option);
    return (
      <div key={option.formField} hidden={!visible}>
        <label className="flex items-start gap-2 text-sm dark:text-white">
          <input
            id={option.formField}
            type="checkbox"
            name={option.formField}
            checked={Boolean(values[option.key])}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                [option.key]: event.target.checked,
              }))
            }
            className="mt-0.5 h-4 w-4 accent-black"
          />
          <span>
            <span className="font-medium">{option.label}</span>
            {option.description ? (
              <span className="mt-0.5 block text-xs text-stone-500 dark:text-stone-400">{option.description}</span>
            ) : null}
          </span>
        </label>
        {children.length > 0 ? (
          <div className="ml-5 mt-2 grid gap-2 border-l border-stone-200 pl-4 dark:border-stone-700">
            {children.map((child) => renderOptionTree(child))}
          </div>
        ) : null}
      </div>
    );
  };

  if (!commentsPluginEnabled) return null;

  return (
    <>
      <label className="flex items-center gap-2 text-sm dark:text-white">
        <input
          id="writing_enable_comments"
          type="checkbox"
          name="writing_enable_comments"
          checked={enableComments}
          onChange={(event) => setEnableComments(event.target.checked)}
          className="h-4 w-4 accent-black"
        />
        Enable comments
      </label>

      {options.length > 0 ? (
        <div
          id="comment-provider-options"
          hidden={!enableComments}
          className="rounded-md border border-stone-200 p-3 dark:border-stone-700"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
            {providerHeading}
          </p>
          <div className="mt-2 grid gap-3">
            {tree.roots.map((option) => renderOptionTree(option))}
          </div>
        </div>
      ) : null}
    </>
  );
}
