import { NextResponse } from "next/server";

export function GET(request: Request) {
  const host = request.headers.get("host");
  if (host) {
    const protocol = host.includes("localhost") ? "http" : "https";
    return NextResponse.redirect(`${protocol}://${host}/icon.png`, 307);
  }
  return NextResponse.redirect(new URL("/icon.png", request.url), 307);
}
