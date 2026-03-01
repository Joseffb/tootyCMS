import CognitoProvider from "next-auth/providers/cognito";

export async function register(_kernel, api) {
  api.registerAuthProvider({
    id: "cognito",
    type: "oauth",
    configSchema: {
      clientId: { type: "string", required: true, minLength: 1 },
      clientSecret: { type: "string", required: true, minLength: 1 },
      issuer: { type: "string", required: true, minLength: 1 },
    },
    async authorize({ config }) {
      const clientId = String(config?.clientId || "").trim();
      const clientSecret = String(config?.clientSecret || "").trim();
      const issuer = String(config?.issuer || "").trim();
      if (!clientId || !clientSecret || !issuer) {
        return { ok: false, error: "Missing OAuth client configuration." };
      }
      return {
        ok: true,
        config: {
          clientId,
          clientSecret,
          issuer,
        },
      };
    },
    async callback() {
      return { allow: true };
    },
    async mapProfile(profile) {
      return {
        id: String(profile.sub || profile.id || ""),
        name: String(profile.name || profile.username || "").trim(),
        email: String(profile.email || "").trim() || null,
        image: String(profile.picture || "").trim() || null,
      };
    },
    createAuthProvider({ config, mapProfile }) {
      return CognitoProvider({
        clientId: String(config.clientId || ""),
        clientSecret: String(config.clientSecret || ""),
        issuer: String(config.issuer || ""),
        profile(profile) {
          return mapProfile(profile);
        },
      });
    },
  });
}
