import { describe, expect, it } from "vitest";
import { buildSessionTokenCookie } from "@/tests/e2e/helpers/auth";

describe("e2e auth session cookie helper", () => {
  it("uses a host-only url cookie for localhost origins", () => {
    expect(
      buildSessionTokenCookie({
        value: "token",
        origin: "http://localhost:3123",
        expires: 123,
      }),
    ).toEqual({
      name: "next-auth.session-token",
      value: "token",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires: 123,
      url: "http://localhost:3123",
    });
  });

  it("uses an explicit domain cookie for non-localhost origins", () => {
    expect(
      buildSessionTokenCookie({
        value: "token",
        origin: "https://robertbetan.test",
        domain: "robertbetan.test",
      }),
    ).toEqual({
      name: "next-auth.session-token",
      value: "token",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      domain: "robertbetan.test",
      path: "/",
    });
  });
});
