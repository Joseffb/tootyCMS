"use client";

import cn from "clsx";
import Image from "next/image";
import { useState } from "react";

import type { ComponentProps } from "react";

export default function BlurImage(props: ComponentProps<typeof Image>) {
  const [isLoading, setLoading] = useState(true);

  // Check if blurDataURL exists; if not, we'll fall back to rendering the image normally
  const { blurDataURL } = props;
  if (!props.src) return null;
  const src = String(props.src);
  const isExternal = src.startsWith("http://") || src.startsWith("https://");
  const isSvg = src.toLowerCase().endsWith(".svg");
  const loadingClass = isLoading && !isSvg ? "scale-105 blur-lg" : "scale-100 blur-0";

  if (isExternal) {
    return (
      <img
        src={src}
        alt={props.alt}
        className={cn(
          props.className,
          "duration-700 ease-in-out",
          loadingClass,
        )}
        onLoad={() => setLoading(false)}
        loading="lazy"
      />
    );
  }

  return (
    <Image
      {...props}
      alt={props.alt}
      className={cn(
        props.className,
        "duration-700 ease-in-out",
        loadingClass
      )}
      onLoad={() => setLoading(false)}
      // Only apply placeholder and blur effect if blurDataURL is available
      placeholder={!isSvg && blurDataURL ? "blur" : undefined}
      blurDataURL={!isSvg ? blurDataURL || undefined : undefined}
      unoptimized={isSvg}
    />
  );
}
