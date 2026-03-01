import AmazonProvider from "next-auth/providers/amazon";

export async function register(_kernel, api) {
  api.registerAuthProvider({
    id: "amazon",
    type: "oauth",
    configSchema: {
      clientId: { type: "string", required: true, minLength: 1 },
      clientSecret: { type: "string", required: true, minLength: 1 },
    },
    async authorize({ config }) {
      const clientId = String(config?.clientId || "").trim();
      const clientSecret = String(config?.clientSecret || "").trim();
      if (!clientId || !clientSecret) {
        return { ok: false, error: "Missing OAuth client configuration." };
      }
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
        id: String(profile.user_id || profile.id || ""),
        name: String(profile.name || "").trim(),
        email: String(profile.email || "").trim() || null,
        image: null,
      };
    },
    createAuthProvider({ config, mapProfile }) {
      return AmazonProvider({
        clientId: String(config.clientId || ""),
        clientSecret: String(config.clientSecret || ""),
        profile(profile) {
          return mapProfile(profile);
        },
      });
    },
  });
}
