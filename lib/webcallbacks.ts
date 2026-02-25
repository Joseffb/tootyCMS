import { and, asc, eq, inArray, lte } from "drizzle-orm";
import db from "@/lib/db";
import { webcallbackEvents } from "@/lib/schema";
import { createKernelForRequest } from "@/lib/plugin-runtime";

export type WebcallbackStatus = "received" | "processed" | "failed" | "ignored";

type DispatchWebcallbackInput = {
  handlerId: string;
  siteId?: string | null;
  body: string;
  headers: Record<string, string>;
  query: Record<string, string | string[]>;
};

export async function dispatchWebcallback(input: DispatchWebcallbackInput) {
  const event = await db
    .insert(webcallbackEvents)
    .values({
      siteId: input.siteId || null,
      handlerId: input.handlerId,
      status: "received",
      requestBody: input.body,
      requestHeaders: input.headers,
      requestQuery: input.query,
    })
    .returning({
      id: webcallbackEvents.id,
    });
  const eventId = event[0]?.id;
  if (!eventId) {
    return { ok: false, statusCode: 500, message: "Failed to create callback event." };
  }

  const kernel = await createKernelForRequest();
  const handler = kernel.getAllPluginWebcallbackHandlers().find((entry) => {
    const full = `${entry.pluginId}:${entry.id}`;
    return entry.id === input.handlerId || full === input.handlerId;
  });

  if (!handler) {
    await db
      .update(webcallbackEvents)
      .set({
        status: "ignored",
        response: { reason: "handler_not_found" },
        updatedAt: new Date(),
      })
      .where(eq(webcallbackEvents.id, eventId));
    return { ok: false, statusCode: 404, message: "No callback handler registered." };
  }

  const providerRef = `${handler.pluginId}:${handler.id}`;
  try {
    const result = await handler.handle({
      body: input.body,
      headers: input.headers,
      query: input.query,
    });
    const ok = Boolean(result?.ok);
    const status: WebcallbackStatus =
      result?.status || (ok ? "processed" : "failed");
    await db
      .update(webcallbackEvents)
      .set({
        pluginId: handler.pluginId,
        status,
        response: result?.response || {},
        error: result?.error || null,
        updatedAt: new Date(),
      })
      .where(eq(webcallbackEvents.id, eventId));
    return {
      ok,
      statusCode: ok ? 202 : 400,
      message: ok ? "Callback processed." : "Callback handler failed.",
      providerRef,
      eventId,
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(webcallbackEvents)
      .set({
        pluginId: handler.pluginId,
        status: "failed",
        error: message,
        updatedAt: new Date(),
      })
      .where(eq(webcallbackEvents.id, eventId));
    return {
      ok: false,
      statusCode: 500,
      message: "Callback handler threw.",
      providerRef,
      eventId,
      error: message,
    };
  }
}

export async function purgeWebcallbackEvents(input?: {
  statuses?: WebcallbackStatus[];
  before?: Date;
}) {
  const statuses = input?.statuses?.length
    ? input.statuses
    : (["processed", "ignored", "failed"] as WebcallbackStatus[]);
  const predicates = [inArray(webcallbackEvents.status, statuses)];
  if (input?.before) predicates.push(lte(webcallbackEvents.createdAt, input.before));
  const deleted = await db
    .delete(webcallbackEvents)
    .where(and(...predicates))
    .returning({ id: webcallbackEvents.id });
  return { count: deleted.length, ids: deleted.map((row) => row.id) };
}

export async function listRecentWebcallbackEvents(limit = 50) {
  return db.query.webcallbackEvents.findMany({
    columns: {
      id: true,
      handlerId: true,
      pluginId: true,
      status: true,
      error: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [asc(webcallbackEvents.createdAt)],
    limit: Math.max(1, limit),
  });
}
