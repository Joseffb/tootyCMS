import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import proxy from "@/proxy";

let mockedToken: Record<string, unknown> | null = null;
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(async () => mockedToken),
}));

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
    delete process.env.ADMIN_PATH;
    delete process.env.NEXTAUTH_URL;
    mockedToken = null;
  });

  it("rewrites canonical /app/cp requests to the internal /app route", async () => {
    mockedToken = { sub: "user-1" };
    const req = makeRequest(
      "http://example.com/app/cp/dashboard",
      "example.com",
      "next-auth.session-token=test-session",
    );

    const response = await proxy(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe("http://example.com/app/dashboard");
  });

  it("rewrites the canonical /app/cp login path to the internal /app login route", async () => {
    const req = makeRequest("http://example.com/app/cp/login", "example.com");

    const response = await proxy(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe("http://example.com/app/login");
  });

  it("preserves /app/cp/login even when a stale auth cookie exists", async () => {
    mockedToken = { sub: "deleted-user" };
    const req = makeRequest(
      "http://example.com/app/cp/login",
      "example.com",
      "next-auth.session-token=stale-session",
    );

    const response = await proxy(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe("http://example.com/app/login");
    expect(response.headers.get("location")).toBeNull();
  });

  it("rewrites canonical /app/cp nested requests to /app", async () => {
    mockedToken = { sub: "user-1" };
    const req = makeRequest(
      "http://example.com/app/cp/settings?tab=profile",
      "example.com",
      "next-auth.session-token=test-session",
    );

    const response = await proxy(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://example.com/app/settings?tab=profile",
    );
  });

  it("rewrites canonical /app/cp root path to /app for server dashboard routing", async () => {
    mockedToken = { sub: "user-1" };
    const req = makeRequest(
      "http://example.com/app/cp",
      "example.com",
      "next-auth.session-token=test-session",
    );

    const response = await proxy(req);

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe("http://example.com/app");
  });

  it("keeps explicit /app/cp/sites on the site index even when a last admin path cookie exists", async () => {
    mockedToken = { sub: "user-1" };
    const req = makeRequest(
      "http://example.com/app/cp/sites",
      "example.com",
      "next-auth.session-token=test-session; cms_last_admin_path=%2Fsite%2Fsite-1%2Fsettings",
    );

    const response = await proxy(req);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe("http://example.com/app/sites");
  });

  it("redirects explicit /app paths on the root host to the canonical /app/cp alias path", async () => {
    const req = makeRequest("http://example.com/app/settings/users", "example.com");

    const response = await proxy(req);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://example.com/app/cp/settings/users");
  });

  it("preserves setup on the root host", async () => {
    const req = makeRequest("http://example.com/setup", "example.com");

    const response = await proxy(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe("http://example.com/setup");
  });

  it("rewrites root about path to shared /about page", async () => {
    const req = makeRequest("http://example.com/about", "example.com");

    const response = await proxy(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://example.com/main.example.com/about",
    );
  });

  it("rewrites other root paths to main site domain key", async () => {
    const req = makeRequest("http://example.com/contact?from=nav", "example.com");

    const response = await proxy(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://example.com/main.example.com/contact?from=nav",
    );
  });

  it("rewrites root slug permalink to main site domain key", async () => {
    const req = makeRequest("http://localhost:3000/welcome-to-tooty", "localhost:3000");

    const response = await proxy(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/main.example.com/welcome-to-tooty",
    );
  });

  it("keeps root homepage at /", async () => {
    const req = makeRequest("http://example.com/", "example.com");

    const response = await proxy(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe("http://example.com/");
  });

  it("rewrites direct /app/cp paths on localhost root host", async () => {
    const req = makeRequest("http://localhost:3001/app/cp/login", "localhost:3001");

    const response = await proxy(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe("http://localhost:3001/app/login");
  });

  it("redirects /app/login on the root host to the canonical /app/cp/login path", async () => {
    const req = makeRequest("http://example.com/app/login", "example.com");

    const response = await proxy(req);

    expect(response.headers.get("location")).toBe("http://example.com/app/cp/login");
  });

  it("redirects bare /login on the root host to the canonical /app/cp/login path", async () => {
    const req = makeRequest("http://example.com/login", "example.com");

    const response = await proxy(req);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://example.com/app/cp/login");
  });

  it("normalizes preview hostnames before tenant rewrite", async () => {
    const req = makeRequest(
      "http://my-site---abc123.vercel.app/blog/my-post",
      "my-site---abc123.vercel.app",
    );

    const response = await proxy(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://my-site---abc123.vercel.app/my-site.example.com/blog/my-post",
    );
  });

  it("treats dashed vercel preview hostnames as root-domain requests", async () => {
    const req = makeRequest(
      "https://fernain-abc123-joseffbs-projects.vercel.app/",
      "fernain-abc123-joseffbs-projects.vercel.app",
    );

    const response = await proxy(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://fernain-abc123-joseffbs-projects.vercel.app/",
    );
  });

  it("treats main.localhost as root-domain alias without redirect loop", async () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "localhost:3000";
    const req = makeRequest("http://main.localhost:3000/", "main.localhost:3000");

    const response = await proxy(req);

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe("http://main.localhost:3000/");
  });

  it("normalizes URL-shaped root-domain config for apex and canonical admin alias routing", async () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "https://RobertBetan.test:3000/";
    process.env.NEXTAUTH_URL = "http://robertbetan.test";

    const apexReq = makeRequest("http://robertbetan.test/contact", "robertbetan.test");
    const apexResponse = await proxy(apexReq);

    expect(apexResponse.headers.get("x-middleware-rewrite")).toBe(
      "http://robertbetan.test/main.robertbetan.test/contact",
    );

    const adminReq = makeRequest("http://robertbetan.test/app/login", "robertbetan.test");
    const adminResponse = await proxy(adminReq);

    expect(adminResponse.headers.get("location")).toBe(
      "http://robertbetan.test/app/cp/login",
    );

    const rootLoginReq = makeRequest("http://robertbetan.test/login", "robertbetan.test");
    const rootLoginResponse = await proxy(rootLoginReq);

    expect(rootLoginResponse.headers.get("location")).toBe(
      "http://robertbetan.test/app/cp/login",
    );
  });

  it("defaults to cp path alias when no explicit admin path is configured", async () => {
    const req = makeRequest("http://example.com/app/cp/login", "example.com");

    const response = await proxy(req);

    expect(response.headers.get("x-middleware-rewrite")).toBe("http://example.com/app/login");
  });

});
