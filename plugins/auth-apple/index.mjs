import AppleProvider from "next-auth/providers/apple";

export async function register(_kernel, api) {
  api.registerAuthProvider({
    id: "apple",
    type: "oauth",
    configSchema: {
      clientId: { type: "string", required: true, minLength: 1 },
      clientSecret: { type: "string", required: true, minLength: 1 },
    },
    async authorize({ config }) {
      const clientId = String(config?.clientId || "").trim();
      const clientSecret = String(config?.clientSecret || "").trim();
      if (!clientId || !clientSecret) return { ok: false, error: "Missing OAuth client configuration." };
      return {
        ok: true,
        config: {
          clientId,
          clientSecret,
        },
      };
    },
    async callback() {
      return { allow: true };
    },
    async mapProfile(profile) {
      return {
        id: String(profile.sub || profile.id || ""),
        name: String(profile.name || "").trim() || "Apple User",
        email: String(profile.email || "").trim() || null,
        image: null,
      };
    },
    createAuthProvider({ config, mapProfile }) {
      return AppleProvider({
        clientId: String(config.clientId || ""),
        clientSecret: String(config.clientSecret || ""),
        profile(profile) {
          return mapProfile(profile);
        },
      });
    },
  });
}
