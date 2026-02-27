import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import db from "@/lib/db";
import { domainPosts } from "@/lib/schema";
import { grantPostPasswordAccess, requiresPostPasswordGate } from "@/lib/post-password";

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

  const post = await db.query.domainPosts.findFirst({
    where: eq(domainPosts.id, postId),
    columns: {
      id: true,
      password: true,
      usePassword: true,
      published: true,
    },
  });

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
