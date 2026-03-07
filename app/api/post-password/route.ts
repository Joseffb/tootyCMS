import { NextResponse } from "next/server";
import { grantPostPasswordAccess, requiresPostPasswordGate } from "@/lib/post-password";
import { findDomainPostForMutation } from "@/lib/site-domain-post-store";

function sanitizeReturnTo(raw: string) {
  const value = String(raw || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function appendPasswordError(path: string) {
  const url = new URL(path, "http://localhost");
  url.searchParams.set("pw", "invalid");
  return `${url.pathname}${url.search}`;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const postId = String(formData.get("postId") || "").trim();
  const passwordInput = String(formData.get("password") || "");
  const returnTo = sanitizeReturnTo(String(formData.get("returnTo") || "/"));

  if (!postId) {
    return NextResponse.redirect(new URL(returnTo, request.url));
  }

  const post = await findDomainPostForMutation(postId);

  if (!post?.id || post.published !== true || !requiresPostPasswordGate(post)) {
    return NextResponse.redirect(new URL(returnTo, request.url));
  }

  if (String(post.password || "") !== passwordInput) {
    return NextResponse.redirect(new URL(appendPasswordError(returnTo), request.url));
  }

  const response = NextResponse.redirect(new URL(returnTo, request.url));
  grantPostPasswordAccess(response.cookies, { postId: post.id, password: post.password });
  return response;
}
