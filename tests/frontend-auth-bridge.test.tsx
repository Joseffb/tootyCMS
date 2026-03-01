// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import FrontendAuthBridge from "@/components/frontend-auth-bridge";

const STORAGE_KEY = "tooty.themeAuthBridge.v1";

function createJwt(expSecondsFromNow: number) {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${header}.${payload}.`;
}

function mockJsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe("FrontendAuthBridge", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/post/example");
    (window as any).__tootyFrontendAuth = undefined;
    (window as any).__tootyFrontendAuthLoggedOut = undefined;
    (window as any).__tootyThemeFrontendLoggedOut = undefined;
    (window as any).__tootyResolveFrontendAuth = undefined;
    (window as any).__tootyPingFrontendBridge = undefined;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("force refresh refetches and replaces the current bridge token", async () => {
    const firstToken = createJwt(300);
    const secondToken = createJwt(600);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          authenticated: true,
          token: firstToken,
          user: { displayName: "First User", knownUser: true },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          authenticated: true,
          token: secondToken,
          user: { displayName: "Second User", knownUser: true },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <>
        <div data-theme-auth-greeting hidden />
        <FrontendAuthBridge />
      </>,
    );

    await waitFor(() =>
      expect((window as any).__tootyFrontendAuth?.token).toBe(firstToken),
    );

    await act(async () => {
      await (window as any).__tootyPingFrontendBridge?.("silent");
    });

    await waitFor(() =>
      expect((window as any).__tootyFrontendAuth?.token).toBe(secondToken),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores expired cached tokens and refetches current auth state", async () => {
    const expiredToken = createJwt(-60);
    const freshToken = createJwt(300);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        token: expiredToken,
        user: { displayName: "Expired User" },
        updatedAt: Date.now(),
      }),
    );
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        authenticated: true,
        token: freshToken,
        user: { displayName: "Fresh User", knownUser: true },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <>
        <div data-theme-auth-greeting hidden />
        <FrontendAuthBridge />
      </>,
    );

    await waitFor(() =>
      expect((window as any).__tootyFrontendAuth?.token).toBe(freshToken),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("syncs bridge auth across tabs via storage events", async () => {
    const initialFetch = vi.fn().mockResolvedValue(
      mockJsonResponse({
        authenticated: false,
      }),
    );
    vi.stubGlobal("fetch", initialFetch);

    render(
      <>
        <div data-theme-auth-greeting hidden />
        <FrontendAuthBridge />
      </>,
    );

    await waitFor(() =>
      expect((window as any).__tootyFrontendAuth?.ready).toBe(true),
    );

    const syncedToken = createJwt(300);
    const rawPayload = JSON.stringify({
      token: syncedToken,
      user: { displayName: "Synced User", knownUser: true },
      updatedAt: Date.now(),
    });
    window.localStorage.setItem(STORAGE_KEY, rawPayload);

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: rawPayload,
          storageArea: window.localStorage,
        }),
      );
    });

    await waitFor(() =>
      expect((window as any).__tootyFrontendAuth?.token).toBe(syncedToken),
    );
    expect(initialFetch).toHaveBeenCalledTimes(1);
  });
});
