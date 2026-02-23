import { NextResponse } from "next/server";
import { isLocalHostLike } from "@/lib/site-url";

export function GET(request: Request) {
  const host = request.headers.get("host");
  if (host) {
    const protocol = isLocalHostLike(host) ? "http" : "https";
    return NextResponse.redirect(`${protocol}://${host}/icon.png`, 307);
  }
  return NextResponse.redirect(new URL("/icon.png", request.url), 307);
}
