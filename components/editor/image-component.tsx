// components/editor/image-component.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import clsx from "clsx";
import Image from "next/image";

export default function ImageComponent(props: any) {
  // Cast once inside – you still keep full IntelliSense
  const { node, updateAttributes } = props as NodeViewProps;
  const {
    src,
    title = "",
    alignment = "center",
    fit = "cover",
    width: rawW,
    height: rawH,
  } = node.attrs;

  // ---- numeric width & height (fallback 200px) -----------------------------
  const numericW =
    typeof rawW === "number" ? rawW :
      rawW ? parseInt(rawW, 10) : 200;
  const numericH =
    typeof rawH === "number" ? rawH :
      rawH ? parseInt(rawH, 10) : 200;

  // ---- keep last valid src -------------------------------------------------
  const srcRef = useRef<string | null>(src);
  useEffect(() => { if (src) srcRef.current = src; }, [src]);

  // ---- local state ---------------------------------------------------------
  const [showMenu, setShowMenu] = useState(false);

  // ---- attr‑merging helpers ------------------------------------------------
  const mergeAttrs = (extra: Record<string, any>) =>
    updateAttributes({ ...node.attrs, width: numericW, height: numericH, ...extra });

  // ---- UI event handlers ---------------------------------------------------
  const handleAlignment = (a: string) => mergeAttrs({ alignment: a });
  const handleFit       = (f: string) => mergeAttrs({ fit: f });
  const handleTitle     = (e: React.ChangeEvent<HTMLInputElement>) =>
    mergeAttrs({ title: e.target.value });

  // ---- wrapper classes -----------------------------------------------------
  const wrapperCls = clsx(
    "relative inline-block group my-4",
    alignment === "left"   && "float-left mr-4",
    alignment === "right"  && "float-right ml-4",
    alignment === "center" && "mx-auto",
    alignment === "block"  && "block w-full"
  );

  return (
    <NodeViewWrapper
      className={wrapperCls}
      onClick={(e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        setShowMenu((v) => !v);
      }}
    >
      {showMenu && (
        <div className="absolute left-1/2 top-0 z-10 flex -translate-x-1/2 gap-2 rounded-md border bg-white p-2 shadow-md">
          <select
            value={alignment}
            onChange={(e) => handleAlignment(e.target.value)}
            className="rounded border px-1 text-sm"
          >
            <option value="block">Block</option>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
          <select
            value={fit}
            onChange={(e) => handleFit(e.target.value)}
            className="rounded border px-1 text-sm"
          >
            <option value="cover">Cover</option>
            <option value="contain">Contain</option>
            <option value="none">None</option>
          </select>
          <input
            type="text"
            value={title ?? ""}
            onChange={handleTitle}
            placeholder="Image title"
            className="rounded border px-1 text-sm"
          />
        </div>
      )}

      {srcRef.current && (
        <Image
          src={srcRef.current}
          alt={title ?? ""}
          width={numericW}
          height={numericH}
          unoptimized
          style={{ objectFit: fit }}
          className="rounded"
        />
      )}
    </NodeViewWrapper>
  );
}
