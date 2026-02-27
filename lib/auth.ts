import { getServerSession, type NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import FacebookProvider from "next-auth/providers/facebook";
import AppleProvider from "next-auth/providers/apple";
import CredentialsProvider from "next-auth/providers/credentials";
import db from "./db";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { Adapter } from "next-auth/adapters";
import { eq, inArray } from "drizzle-orm";
import { accounts, sessions, users, verificationTokens } from "./schema";
import { verifyPassword } from "@/lib/password";
import { AUTH_PLUGIN_PROVIDER_MAP } from "@/lib/auth-provider-plugins";
import { NETWORK_ADMIN_ROLE, type SiteCapability } from "@/lib/rbac";
import { getAuthorizedSiteForUser } from "@/lib/authorization";
import { getUserMetaValue } from "@/lib/user-meta";
import { cookies } from "next/headers";
import { getSettingByKey, getSettingsByKeys } from "@/lib/settings-store";
import {
  DefaultPostgresAccountsTable,
  DefaultPostgresSessionsTable,
  DefaultPostgresUsersTable, DefaultPostgresVerificationTokenTable
} from "@auth/drizzle-adapter/lib/pg";

const VERCEL_DEPLOYMENT = !!process.env.VERCEL_URL;
export const MIMIC_ACTOR_COOKIE = "tooty_mimic_actor";
export const MIMIC_TARGET_COOKIE = "tooty_mimic_target";
const SUPPORTED_OAUTH_PROVIDERS = ["github", "google", "facebook", "apple"] as const;
type OAuthProviderId = (typeof SUPPORTED_OAUTH_PROVIDERS)[number];
const PROVIDER_TO_PLUGIN: Record<OAuthProviderId, keyof typeof AUTH_PLUGIN_PROVIDER_MAP> = {
  github: "auth-github",
  google: "auth-google",
  facebook: "auth-facebook",
  apple: "auth-apple",
};

type OAuthProviderRuntimeConfig = {
  clientId: string;
  clientSecret: string;
  source: "db" | "env" | "none";
};

const OAUTH_ENV_KEYS: Record<OAuthProviderId, { id: string; secret: string }> = {
  github: { id: "AUTH_GITHUB_ID", secret: "AUTH_GITHUB_SECRET" },
  google: { id: "AUTH_GOOGLE_ID", secret: "AUTH_GOOGLE_SECRET" },
  facebook: { id: "AUTH_FACEBOOK_ID", secret: "AUTH_FACEBOOK_SECRET" },
  apple: { id: "AUTH_APPLE_ID", secret: "AUTH_APPLE_SECRET" },
};

function normalizeCookieDomain(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function deriveLocalCookieDomainForUrl(nextAuthUrl: string) {
  const normalized = String(nextAuthUrl || "").trim();
  if (!normalized) return undefined;
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    // Browsers inconsistently accept Domain=.localhost cookies.
    // For local development, prefer host-only cookies unless explicitly configured
    // with NEXTAUTH_COOKIE_DOMAIN.
    if (hostname === "localhost" || hostname.endsWith(".localhost")) return undefined;
    const parts = hostname.split(".").filter(Boolean);
    if (parts.length >= 3) {
      return `.${parts.slice(1).join(".")}`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function deriveLocalCookieDomain() {
  const explicit = normalizeCookieDomain(String(process.env.NEXTAUTH_COOKIE_DOMAIN || ""));
  if (explicit) return explicit;
  return deriveLocalCookieDomainForUrl(String(process.env.NEXTAUTH_URL || ""));
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function getOauthProviderRuntimeConfig() {
  const configKeys = SUPPORTED_OAUTH_PROVIDERS.map(
    (id) => `plugin_${PROVIDER_TO_PLUGIN[id]}_config`,
  );
  const byKey = await getSettingsByKeys(configKeys);
  const runtime = {} as Record<OAuthProviderId, OAuthProviderRuntimeConfig>;

  for (const providerId of SUPPORTED_OAUTH_PROVIDERS) {
    const pluginId = PROVIDER_TO_PLUGIN[providerId];
    const config = parseJsonObject(byKey[`plugin_${pluginId}_config`]);
    const dbClientId = String(config.clientId || "").trim();
    const dbClientSecret = String(config.clientSecret || "").trim();
    if (dbClientId && dbClientSecret) {
      runtime[providerId] = {
        clientId: dbClientId,
        clientSecret: dbClientSecret,
        source: "db",
      };
      continue;
    }

    const envClientId = String(process.env[OAUTH_ENV_KEYS[providerId].id] || "").trim();
    const envClientSecret = String(process.env[OAUTH_ENV_KEYS[providerId].secret] || "").trim();
    if (envClientId && envClientSecret) {
      runtime[providerId] = {
        clientId: envClientId,
        clientSecret: envClientSecret,
        source: "env",
      };
      continue;
    }

    runtime[providerId] = {
      clientId: "",
      clientSecret: "",
      source: "none",
    };
  }

  return runtime;
}

async function getOauthProviderFlags() {
  const keys = SUPPORTED_OAUTH_PROVIDERS.map((id) => `plugin_${PROVIDER_TO_PLUGIN[id]}_enabled`);
  const byKey = await getSettingsByKeys(keys);

  const result: Record<OAuthProviderId, boolean> = {
    github: true,
    google: true,
    facebook: true,
    apple: true,
  };

  for (const id of SUPPORTED_OAUTH_PROVIDERS) {
    result[id] = byKey[`plugin_${PROVIDER_TO_PLUGIN[id]}_enabled`] === "true";
  }
  return result;
}

async function getBootstrapAdminEmail() {
  return String((await getSettingByKey("bootstrap_admin_email")) || "")
    .trim()
    .toLowerCase();
}

function fallbackOauthRuntimeConfig(): Record<OAuthProviderId, OAuthProviderRuntimeConfig> {
  return {
    github: {
      clientId: String(process.env.AUTH_GITHUB_ID || ""),
      clientSecret: String(process.env.AUTH_GITHUB_SECRET || ""),
      source: "env",
    },
    google: {
      clientId: String(process.env.AUTH_GOOGLE_ID || ""),
      clientSecret: String(process.env.AUTH_GOOGLE_SECRET || ""),
      source: "env",
    },
    facebook: {
      clientId: String(process.env.AUTH_FACEBOOK_ID || ""),
      clientSecret: String(process.env.AUTH_FACEBOOK_SECRET || ""),
      source: "env",
    },
    apple: {
      clientId: String(process.env.AUTH_APPLE_ID || ""),
      clientSecret: String(process.env.AUTH_APPLE_SECRET || ""),
      source: "env",
    },
  };
}

export async function enforceOauthAccountLinkingPolicy(input: {
  providerId: OAuthProviderId;
  providerAccountId: string;
  oauthEmail?: string | null;
  oauthUserId?: string | null;
}) {
  const providerId = input.providerId;
  const providerAccountId = String(input.providerAccountId || "").trim();
  const oauthEmail = String(input.oauthEmail || "").trim().toLowerCase();
  const oauthUserId = String(input.oauthUserId || "").trim();

  if (!providerAccountId) {
    return {
      allow: false as const,
      error: "Missing OAuth provider account identifier.",
    };
  }

  const linkedAccount = await db.query.accounts.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.provider, providerId), eq(table.providerAccountId, providerAccountId)),
    columns: { userId: true },
  });
  if (linkedAccount) {
    // Account is already linked in adapter table. Allow sign-in.
    return { allow: true as const };
  }

  // No linked account exists yet. Refuse unsafe email auto-linking to existing users.
  if (!oauthEmail) {
    return {
      allow: false as const,
      error: "OAuth provider did not return an email for account linking.",
    };
  }

  const existingUserByEmail = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.email, oauthEmail),
    columns: { id: true, authProvider: true },
  });
  if (existingUserByEmail) {
    const sameUser = oauthUserId && existingUserByEmail.id === oauthUserId;
    if (!sameUser) {
      return {
        allow: false as const,
        error: "OAuth account is not linked for this email. Sign in natively first.",
      };
    }
  }

  return { allow: true as const };
}

function buildProviders(
  oauthRuntime: Record<OAuthProviderId, OAuthProviderRuntimeConfig>,
): NextAuthOptions["providers"] {
  const providers: NextAuthOptions["providers"] = [];

  if (oauthRuntime.github.clientId && oauthRuntime.github.clientSecret) {
    providers.push(
      GitHubProvider({
        clientId: oauthRuntime.github.clientId,
        clientSecret: oauthRuntime.github.clientSecret,
        profile(profile) {
          return {
            id: profile.id.toString(),
            name: profile.name || profile.login,
            gh_username: profile.login,
            email: profile.email,
            image: profile.avatar_url,
          };
        },
      }),
    );
  }

  if (oauthRuntime.google.clientId && oauthRuntime.google.clientSecret) {
    providers.push(
      GoogleProvider({
        clientId: oauthRuntime.google.clientId,
        clientSecret: oauthRuntime.google.clientSecret,
      }),
    );
  }

  if (oauthRuntime.facebook.clientId && oauthRuntime.facebook.clientSecret) {
    providers.push(
      FacebookProvider({
        clientId: oauthRuntime.facebook.clientId,
        clientSecret: oauthRuntime.facebook.clientSecret,
      }),
    );
  }

  if (oauthRuntime.apple.clientId && oauthRuntime.apple.clientSecret) {
    providers.push(
      AppleProvider({
        clientId: oauthRuntime.apple.clientId,
        clientSecret: oauthRuntime.apple.clientSecret,
      }),
    );
  }

  providers.push(
    CredentialsProvider({
      id: "native",
      name: "Native",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || "").trim().toLowerCase();
        const password = String(credentials?.password || "");
        if (!email || !password) return null;
        const user = await db.query.users.findFirst({
          where: (table, { eq }) => eq(table.email, email),
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
            username: true,
            gh_username: true,
            passwordHash: true,
          },
        });
        if (!user || !user.passwordHash) return null;
        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;
        return {
          id: user.id,
          name: user.name ?? user.email,
          email: user.email,
          image: user.image ?? null,
          username: user.username ?? user.gh_username ?? null,
        };
      },
    }),
  );

  return providers;
}

export async function getAuthOptions(): Promise<NextAuthOptions> {
  const oauthRuntime =
    (await getOauthProviderRuntimeConfig().catch(() => null)) ?? fallbackOauthRuntimeConfig();

  return {
    providers: buildProviders(oauthRuntime),
    pages: {
      signIn: `/login`,
      verifyRequest: `/login`,
      error: "/login", // Error code passed in query string as ?error=
    },

    adapter: DrizzleAdapter(db, {
      authenticatorsTable: undefined,
      usersTable: users as unknown as DefaultPostgresUsersTable,
      accountsTable: accounts as unknown as DefaultPostgresAccountsTable,
      sessionsTable: sessions as unknown as DefaultPostgresSessionsTable,
      verificationTokensTable:
        verificationTokens as unknown as DefaultPostgresVerificationTokenTable,
    }) as Adapter,
    session: { strategy: "jwt" },
    cookies: {
      sessionToken: {
        name: `${VERCEL_DEPLOYMENT ? "__Secure-" : ""}next-auth.session-token`,
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          // In local subdomain dev (e.g. app.localhost/main.localhost), share auth cookies across subdomains.
          domain: VERCEL_DEPLOYMENT
            ? `.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`
            : deriveLocalCookieDomain(),
          secure: VERCEL_DEPLOYMENT,
        },
      },
    },
    callbacks: {
      signIn: async ({ account, user }) => {
        if (account?.provider === "native" && user?.id) {
          const mustRotate = await getUserMetaValue(String(user.id), "force_password_change");
          if (mustRotate === "true") {
            return "/settings/profile?forcePasswordChange=1";
          }
          return true;
        }
        if (account?.provider === "native") return true;
        const providerId = account?.provider as OAuthProviderId | undefined;
        if (!providerId || !SUPPORTED_OAUTH_PROVIDERS.includes(providerId)) {
          return true;
        }

        const flags = await getOauthProviderFlags();
        if (!flags[providerId]) {
          return "/login?error=OAuth provider disabled by admin";
        }
        const linking = await enforceOauthAccountLinkingPolicy({
          providerId,
          providerAccountId: String(account?.providerAccountId || ""),
          oauthEmail: user.email,
          oauthUserId: user.id,
        });
        if (!linking.allow) {
          return `/login?error=${encodeURIComponent(linking.error)}`;
        }
        const bootstrapAdminEmail = await getBootstrapAdminEmail();
        if (bootstrapAdminEmail) {
          const userEmail = user.email?.trim().toLowerCase() || "";
          const anyUser = await db.query.users.findFirst({ columns: { id: true } });
          if (!anyUser && userEmail !== bootstrapAdminEmail) {
            return "/login?error=Use the setup admin email for first login";
          }
        }
        return true;
      },
      jwt: async ({ token, user }) => {
        if (user) {
          const displayName = await getUserMetaValue(String((user as any).id || ""), "display_name");
          token.user = {
            ...user,
            displayName: String(displayName || "").trim() || (user as any).username || "",
          };
        }
        if (token.sub) {
          const mustRotate = await getUserMetaValue(token.sub, "force_password_change");
          (token as any).forcePasswordChange = mustRotate === "true";
        } else {
          (token as any).forcePasswordChange = false;
        }
        return token;
      },
      session: async ({ session, token }) => {
        const userRole = token.sub
          ? await db.query.users.findFirst({
              where: (users, { eq }) => eq(users.id, token.sub!),
              columns: { role: true },
            })
          : null;
        session.user = {
          ...session.user,
          // @ts-expect-error
          id: token.sub,
          // @ts-expect-error
          username: token?.user?.username || token?.user?.gh_username,
          role: userRole?.role ?? "author",
          displayName: String((token as any)?.user?.displayName || "").trim(),
          forcePasswordChange: Boolean((token as any)?.forcePasswordChange),
        };
        return session;
      },
    },
    events: {
      error: async (message: unknown) => {
        console.error("NextAuth error event:", message);
      },
      createUser: async () => {},
    } as any, // casting as any to bypass TS type checking for events
  };
}

export async function getSession() {
  const authOptions = await getAuthOptions();
  const baseSession = await (getServerSession(authOptions) as Promise<{
    user: {
      id: string;
      name: string;
      username: string;
      role: string;
      email: string;
      image: string;
    };
  } | null>);
  if (!baseSession?.user?.id) return baseSession;

  const store = await cookies();
  const actorId = String(store.get(MIMIC_ACTOR_COOKIE)?.value || "").trim();
  const targetId = String(store.get(MIMIC_TARGET_COOKIE)?.value || "").trim();
  if (!actorId || !targetId || actorId !== baseSession.user.id || targetId === actorId) {
    return baseSession;
  }

  const target = await db.query.users.findFirst({
    where: eq(users.id, targetId),
    columns: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
    },
  });
  if (!target) return baseSession;

  return {
    ...baseSession,
    user: {
      ...baseSession.user,
      id: target.id,
      name: target.name ?? target.email,
      email: target.email,
      image: target.image ?? baseSession.user.image,
      role: target.role ?? "author",
      username: (baseSession.user as any).username,
      mimicActorId: actorId,
      mimicTargetId: target.id,
      mimicActorName: baseSession.user.name,
      mimicActorEmail: baseSession.user.email,
    } as any,
  };
}

export function withSiteAuth(action: any, capability: SiteCapability = "network.site.manage") {
  return async (
    formData: FormData | null,
    siteId: string,
    key: string | null,
  ) => {
    const session = await getSession();
    if (!session) {
      return {
        error: "Not authenticated",
      };
    }

    const site = await getAuthorizedSiteForUser(session.user.id, siteId, capability);
    if (!site) {
      return {
        error: "Not authorized",
      };
    }

    return action(formData, site, key);
  };
}

export function withPostAuth(action: any) {
  return async (
    formData: FormData | null,
    postId: string,
    key: string | null,
  ) => {
    const session = await getSession();
    if (!session?.user.id) {
      return {
        error: "Not authenticated",
      };
    }

    const post = await db.query.posts.findFirst({
      where: (posts, { eq }) => eq(posts.id, postId),
      with: {
        site: true,
      },
    });

    if (!post || post.userId !== session.user.id) {
      return {
        error: "Post not found",
      };
    }

    return action(formData, post, key);
  };
}
