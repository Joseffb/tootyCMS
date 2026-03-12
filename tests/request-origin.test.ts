import { describe, expect, it } from "vitest";
import { deriveRequestOriginFromRequest } from "@/lib/request-origin";

describe("deriveRequestOriginFromRequest", () => {
  it("prefers forwarded host and protocol for proxied local domains", () => {
    const request = new Request("http://localhost:3000/app/site/site-1/domain/post/create/draft", {
      headers: {
        "x-forwarded-host": "robertbetan.test",
        "x-forwarded-proto": "https",
        host: "localhost:3000",
      },
      method: "POST",
    });

    expect(deriveRequestOriginFromRequest(request)).toBe("https://robertbetan.test");
  });

  it("falls back to request origin when forwarded headers are absent", () => {
    const request = new Request("http://localhost:3000/app/site/site-1/domain/post/create/draft", {
      method: "POST",
    });

    expect(deriveRequestOriginFromRequest(request)).toBe("http://localhost:3000");
  });
});
