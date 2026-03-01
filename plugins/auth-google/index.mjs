import GoogleProvider from "next-auth/providers/google";

export async function register(_kernel, api) {
  api.registerAuthProvider({
    id: "google",
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
        name: String(profile.name || "").trim(),
        email: String(profile.email || "").trim() || null,
        image: String(profile.picture || profile.image || "").trim() || null,
      };
    },
    createAuthProvider({ config, mapProfile }) {
      return GoogleProvider({
        clientId: String(config.clientId || ""),
        clientSecret: String(config.clientSecret || ""),
        profile(profile) {
          return mapProfile(profile);
        },
      });
    },
  });
}
