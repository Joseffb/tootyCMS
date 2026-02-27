import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { userCan } from "@/lib/authorization";
import { getPluginById, getPluginConfig, savePluginConfig } from "@/lib/plugin-runtime";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const canManagePlugins = await userCan("network.plugins.manage", session.user.id);
  if (!canManagePlugins) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let payload: any = null;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const pluginId = String(payload?.pluginId || "").trim();
  const key = String(payload?.key || "").trim();
  const value = payload?.value;

  if (!pluginId || !key) {
    return NextResponse.json({ ok: false, error: "pluginId and key are required" }, { status: 400 });
  }

  const plugin = await getPluginById(pluginId);
  if (!plugin) {
    return NextResponse.json({ ok: false, error: "Plugin not found" }, { status: 404 });
  }

  const currentConfig = (await getPluginConfig(pluginId)) as Record<string, unknown>;
  await savePluginConfig(pluginId, {
    ...currentConfig,
    [key]: value,
  });

  return NextResponse.json({ ok: true });
}

