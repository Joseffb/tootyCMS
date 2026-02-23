import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import middleware from "@/middleware";

function makeRequest(url: string, host: string, cookie?: string) {
  const headers: Record<string, string> = { host };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(url, {
    headers,
  });
}

describe("middleware routing", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "example.com";
    process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_SUFFIX = "vercel.app";
  });

  it("redirects unauthenticated app users to login", async () => {
    const req = makeRequest("http://app.example.com/dashboard", "app.example.com");

    const response = await middleware(req);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://app.example.com/login");
  });

  it("redirects authenticated users away from login page", async () => {
    const req = makeRequest(
      "http://app.example.com/login",
      "app.example.com",
      "next-auth.session-token=fake-token",
    );

    const response = await middleware(req);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://app.example.com/");
  });

  it("rewrites authenticated app requests to /app", async () => {
    const req = makeRequest(
      "http://app.example.com/settings?tab=profile",
      "app.example.com",
      "next-auth.session-token=fake-token",
    );

    const response = await middleware(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://app.example.com/app/settings?tab=profile",
    );
  });

  it("rewrites authenticated app root path to /app", async () => {
    const req = makeRequest(
      "http://app.example.com/",
      "app.example.com",
      "next-auth.session-token=fake-token",
    );

    const response = await middleware(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe("http://app.example.com/app");
  });

  it("rewrites root about path to shared /about page", async () => {
    const req = makeRequest("http://example.com/about", "example.com");

    const response = await middleware(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://example.com/main.example.com/about",
    );
  });

  it("rewrites other root paths to main site domain key", async () => {
    const req = makeRequest("http://example.com/contact?from=nav", "example.com");

    const response = await middleware(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://example.com/main.example.com/contact?from=nav",
    );
  });

  it("rewrites root slug permalink to main site domain key", async () => {
    const req = makeRequest("http://localhost:3000/welcome-to-tooty", "localhost:3000");

    const response = await middleware(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/main.example.com/welcome-to-tooty",
    );
  });

  it("keeps root homepage at /", async () => {
    const req = makeRequest("http://example.com/", "example.com");

    const response = await middleware(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe("http://example.com/");
  });

  it("preserves direct /app paths on localhost root host", async () => {
    const req = makeRequest("http://localhost:3001/app/login", "localhost:3001");

    const response = await middleware(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe("http://localhost:3001/app/login");
  });

  it("normalizes /app/login on app subdomain to single /app/login rewrite", async () => {
    const req = makeRequest("http://app.example.com/app/login", "app.example.com");

    const response = await middleware(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe("http://app.example.com/app/login");
  });

  it("normalizes preview hostnames before tenant rewrite", async () => {
    const req = makeRequest(
      "http://my-site---abc123.vercel.app/blog/my-post",
      "my-site---abc123.vercel.app",
    );

    const response = await middleware(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://my-site---abc123.vercel.app/my-site.example.com/blog/my-post",
    );
  });

  it("treats main.localhost as root-domain alias without redirect loop", async () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "localhost:3000";
    const req = makeRequest("http://main.localhost:3000/", "main.localhost:3000");

    const response = await middleware(req);

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe("http://main.localhost:3000/");
  });
});
