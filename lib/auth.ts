import { getServerSession, type NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import FacebookProvider from "next-auth/providers/facebook";
import AppleProvider from "next-auth/providers/apple";
import db from "./db";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { Adapter } from "next-auth/adapters";
import { eq, inArray } from "drizzle-orm";
import { accounts, cmsSettings, sessions, users, verificationTokens } from "./schema";
import {
  DefaultPostgresAccountsTable,
  DefaultPostgresSessionsTable,
  DefaultPostgresUsersTable, DefaultPostgresVerificationTokenTable
} from "@auth/drizzle-adapter/lib/pg";

const VERCEL_DEPLOYMENT = !!process.env.VERCEL_URL;
const providers: NextAuthOptions["providers"] = [];
const SUPPORTED_OAUTH_PROVIDERS = ["github", "google", "facebook", "apple"] as const;
type OAuthProviderId = (typeof SUPPORTED_OAUTH_PROVIDERS)[number];

function isProviderConfigured(id: OAuthProviderId) {
  if (id === "github") return !!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
  if (id === "google") return !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  if (id === "facebook") return !!(process.env.AUTH_FACEBOOK_ID && process.env.AUTH_FACEBOOK_SECRET);
  return !!(process.env.AUTH_APPLE_ID && process.env.AUTH_APPLE_SECRET);
}

async function getOauthProviderFlags() {
  const rows = await db
    .select({ key: cmsSettings.key, value: cmsSettings.value })
    .from(cmsSettings)
    .where(
      inArray(
        cmsSettings.key,
        SUPPORTED_OAUTH_PROVIDERS.map((id) => `oauth_provider_${id}_enabled`),
      ),
    );

  const result: Record<OAuthProviderId, boolean> = {
    github: true,
    google: true,
    facebook: true,
    apple: true,
  };

  for (const id of SUPPORTED_OAUTH_PROVIDERS) {
    const row = rows.find((item) => item.key === `oauth_provider_${id}_enabled`);
    if (row) {
      result[id] = row.value === "true";
    }
  }
  return result;
}

if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHubProvider({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
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

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  );
}

if (process.env.AUTH_FACEBOOK_ID && process.env.AUTH_FACEBOOK_SECRET) {
  providers.push(
    FacebookProvider({
      clientId: process.env.AUTH_FACEBOOK_ID,
      clientSecret: process.env.AUTH_FACEBOOK_SECRET,
    }),
  );
}

if (process.env.AUTH_APPLE_ID && process.env.AUTH_APPLE_SECRET) {
  providers.push(
    AppleProvider({
      clientId: process.env.AUTH_APPLE_ID,
      clientSecret: process.env.AUTH_APPLE_SECRET,
    }),
  );
}

export const authOptions: NextAuthOptions = {
  providers,
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
        // When working on localhost, the cookie domain must be omitted entirely (https://stackoverflow.com/a/1188145)
        domain: VERCEL_DEPLOYMENT
          ? `.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`
          : undefined,
        secure: VERCEL_DEPLOYMENT,
      },
    },
  },
  callbacks: {
    signIn: async ({ account }) => {
      const providerId = account?.provider as OAuthProviderId | undefined;
      if (!providerId || !SUPPORTED_OAUTH_PROVIDERS.includes(providerId)) {
        return true;
      }

      const flags = await getOauthProviderFlags();
      if (!flags[providerId]) {
        return "/login?error=OAuth provider disabled by admin";
      }
      return true;
    },
    jwt: async ({ token, user }) => {
      if (user) {
        token.user = user;
      }
      return token;
    },
    session: async ({ session, token }) => {
      let userRole = token.sub
        ? await db.query.users.findFirst({
            where: (users, { eq }) => eq(users.id, token.sub!),
            columns: { role: true },
          })
        : null;

      if (!userRole && token.sub && session.user?.email) {
        const anyUser = await db.query.users.findFirst({
          columns: { id: true },
        });
        await db
          .insert(users)
          .values({
            id: token.sub,
            email: session.user.email.toLowerCase(),
            name: session.user.name ?? null,
            image: session.user.image ?? null,
            role: anyUser ? "author" : "administrator",
          })
          .onConflictDoNothing();

        userRole = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, token.sub!),
          columns: { role: true },
        });
      }

      const anyAdmin = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.role, "administrator"),
        columns: { id: true },
      });
      if (!anyAdmin && token.sub) {
        await db
          .update(users)
          .set({ role: "administrator" })
          .where(eq(users.id, token.sub));
        userRole = { role: "administrator" };
      }
      session.user = {
        ...session.user,
        // @ts-expect-error
        id: token.sub,
        // @ts-expect-error
        username: token?.user?.username || token?.user?.gh_username,
        role: userRole?.role ?? "author",
      };
      return session;
    },
  },
  events: {
    error: async (message: unknown) => {
      console.error("NextAuth error event:", message);
    },
    createUser: async ({ user }: { user: { id?: string } }) => {
      if (!user?.id) return;
      const firstUser = await db.query.users.findFirst({
        columns: { id: true },
        orderBy: (users, { asc }) => [asc(users.createdAt)],
      });
      if (firstUser?.id === user.id) {
        await db
          .update(users)
          .set({ role: "administrator" })
          .where(eq(users.id, user.id));
      }
    },
  } as any, // casting as any to bypass TS type checking for events

};

export function getSession() {
  return getServerSession(authOptions) as Promise<{
    user: {
      id: string;
      name: string;
      username: string;
      role: string;
      email: string;
      image: string;
    };
  } | null>;
}

export function withSiteAuth(action: any) {
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

    const site = await db.query.sites.findFirst({
      where: (sites, { eq }) => eq(sites.id, siteId),
    });

    if (!site || site.userId !== session.user.id) {
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
