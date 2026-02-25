export const AUTH_PLUGIN_PROVIDER_MAP = {
  "auth-github": "github",
  "auth-google": "google",
  "auth-facebook": "facebook",
  "auth-apple": "apple",
} as const;

export type AuthPluginId = keyof typeof AUTH_PLUGIN_PROVIDER_MAP;
export type OAuthProviderId = (typeof AUTH_PLUGIN_PROVIDER_MAP)[AuthPluginId];

export const AUTH_PLUGIN_IDS = Object.keys(AUTH_PLUGIN_PROVIDER_MAP) as AuthPluginId[];

export function isAuthPluginId(pluginId: string): pluginId is AuthPluginId {
  return pluginId in AUTH_PLUGIN_PROVIDER_MAP;
}

