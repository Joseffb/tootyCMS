import { NextResponse } from "next/server";
import { listPluginsWithState } from "@/lib/plugin-runtime";

export async function GET() {
  const plugins = await listPluginsWithState();
  const providers = plugins
    .filter((plugin) => plugin.capabilities?.authExtensions && plugin.authProviderId)
    .map((plugin) => ({
      id: plugin.authProviderId as string,
      name: plugin.name,
      enabled: plugin.enabled,
      pluginId: plugin.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const enabled = Object.fromEntries(providers.map((provider) => [provider.id, provider.enabled]));
  return NextResponse.json({ enabled, providers });
}
