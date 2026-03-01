import GitHubProvider from "next-auth/providers/github";

export async function register(_kernel, api) {
  api.registerAuthProvider({
    id: "github",
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
        id: String(profile.id || ""),
        name: String(profile.name || profile.login || "").trim(),
        email: String(profile.email || "").trim() || null,
        image: String(profile.avatar_url || "").trim() || null,
        username: String(profile.login || "").trim() || null,
        gh_username: String(profile.login || "").trim() || null,
      };
    },
    createAuthProvider({ config, mapProfile }) {
      return GitHubProvider({
        clientId: String(config.clientId || ""),
        clientSecret: String(config.clientSecret || ""),
        profile(profile) {
          return mapProfile(profile);
        },
      });
    },
  });
}
