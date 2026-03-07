"use client";

import { useEffect } from "react";

type PostViewTrackerProps = {
  postId: string;
  siteId: string;
  dataDomainKey: string;
};

export default function PostViewTracker(props: PostViewTrackerProps) {
  useEffect(() => {
    const postId = String(props.postId || "").trim();
    const siteId = String(props.siteId || "").trim();
    const dataDomainKey = String(props.dataDomainKey || "").trim();
    if (!postId || !siteId || !dataDomainKey) return;

    const storageKey = `tooty:view-count:${postId}`;
    try {
      if (window.sessionStorage.getItem(storageKey) === "1") return;
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // Ignore storage failures; the server throttle still protects the counter.
    }

    void fetch(`/api/domain-posts/${encodeURIComponent(postId)}/view`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ siteId, dataDomainKey }),
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {
      // Ignore background counter failures.
    });
  }, [props.dataDomainKey, props.postId, props.siteId]);

  return null;
}
