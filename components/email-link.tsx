"use client";

import { useEffect, useRef } from "react";

interface Props {
  encoded: string;            // base‑64 of the full address
  className?: string;
}

export default function EmailLink({ encoded, className }: Props) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const decoded = atob(encoded);   // built‑in browser base64 decoder
    el.href = `mailto:${decoded}`;
    el.textContent = decoded;
  }, [encoded]);

  return <a ref={ref} data-e={encoded} className={className} />;
}
