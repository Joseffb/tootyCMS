import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  userCan: vi.fn(),
  sendCommunication: vi.fn(),
  applyCommunicationCallback: vi.fn(),
  createKernelForRequest: vi.fn(),
  dispatchWebcallback: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/authorization", () => ({
  userCan: mocks.userCan,
}));

vi.mock("@/lib/communications", () => ({
  sendCommunication: mocks.sendCommunication,
  applyCommunicationCallback: mocks.applyCommunicationCallback,
  CommunicationGovernanceError: class CommunicationGovernanceError extends Error {
    code: "disabled" | "rate_limited";
    status: 403 | 429;
    details?: Record<string, unknown>;
    constructor(
      code: "disabled" | "rate_limited",
      message: string,
      status: 403 | 429,
      details?: Record<string, unknown>,
    ) {
      super(message);
      this.code = code;
      this.status = status;
      this.details = details;
    }
  },
}));

vi.mock("@/lib/plugin-runtime", () => ({
  createKernelForRequest: mocks.createKernelForRequest,
}));

vi.mock("@/lib/webcallbacks", () => ({
  dispatchWebcallback: mocks.dispatchWebcallback,
}));

import { POST as sendCommunicationRoute } from "@/app/api/communications/send/route";
import { POST as communicationCallbackRoute } from "@/app/api/communications/callback/[provider]/route";
import { POST as webcallbackRoute } from "@/app/api/webcallbacks/[handler]/route";

describe("communication routes", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.userCan.mockReset();
    mocks.sendCommunication.mockReset();
    mocks.applyCommunicationCallback.mockReset();
    mocks.createKernelForRequest.mockReset();
    mocks.dispatchWebcallback.mockReset();
  });

  it("denies send route when unauthenticated", async () => {
    mocks.getSession.mockResolvedValue(null);
    const req = new Request("http://localhost/api/communications/send", {
      method: "POST",
      body: JSON.stringify({ channel: "email", to: "a@example.com", body: "hello" }),
    });
    const response = await sendCommunicationRoute(req as any);
    expect(response.status).toBe(401);
  });

  it("sends communication when authorized", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "admin-1" } });
    mocks.userCan.mockResolvedValue(true);
    mocks.sendCommunication.mockResolvedValue({
      ok: true,
      status: "logged",
      providerId: "native:null-provider",
      messageId: "msg-1",
    });
    const req = new Request("http://localhost/api/communications/send", {
      method: "POST",
      body: JSON.stringify({ channel: "email", to: "a@example.com", body: "hello" }),
    });
    const response = await sendCommunicationRoute(req as any);
    expect(response.status).toBe(202);
    const json = await response.json();
    expect(json.messageId).toBe("msg-1");
  });

  it("returns 403 when communication is disabled by governance", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "admin-1" } });
    mocks.userCan.mockResolvedValue(true);
    mocks.sendCommunication.mockRejectedValue({
      message: "Communication is disabled for this site.",
      code: "disabled",
      status: 403,
      details: { siteId: "site-1" },
    });
    const req = new Request("http://localhost/api/communications/send", {
      method: "POST",
      body: JSON.stringify({ siteId: "site-1", channel: "email", to: "a@example.com", body: "hello" }),
    });
    const response = await sendCommunicationRoute(req as any);
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.code).toBe("disabled");
  });

  it("returns 429 when communication rate limit is exceeded", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "admin-1" } });
    mocks.userCan.mockResolvedValue(true);
    mocks.sendCommunication.mockRejectedValue({
      message: "Communication rate limit exceeded for this site.",
      code: "rate_limited",
      status: 429,
      details: { siteId: "site-1", limit: 1, windowSeconds: 60 },
    });
    const req = new Request("http://localhost/api/communications/send", {
      method: "POST",
      body: JSON.stringify({ siteId: "site-1", channel: "email", to: "a@example.com", body: "hello" }),
    });
    const response = await sendCommunicationRoute(req as any);
    expect(response.status).toBe(429);
    const json = await response.json();
    expect(json.code).toBe("rate_limited");
  });

  it("handles native-null callback", async () => {
    mocks.applyCommunicationCallback.mockResolvedValue({ ok: true, messageId: "msg-1" });
    const req = new NextRequest("http://localhost/api/communications/callback/native-null", {
      method: "POST",
      body: JSON.stringify({ messageId: "msg-1", status: "sent" }),
    });
    const response = await communicationCallbackRoute(req as any, {
      params: Promise.resolve({ provider: "native-null" }),
    });
    expect(response.status).toBe(202);
  });

  it("dispatches generic webcallback handler route", async () => {
    mocks.dispatchWebcallback.mockResolvedValue({
      ok: true,
      statusCode: 202,
      message: "Callback processed.",
      eventId: 10,
    });
    const req = new NextRequest("http://localhost/api/webcallbacks/echo", {
      method: "POST",
      body: '{"ok":true}',
    });
    const response = await webcallbackRoute(req as any, {
      params: Promise.resolve({ handler: "echo" }),
    });
    expect(response.status).toBe(202);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.eventId).toBe(10);
  });
});
