/**
 * @type {import("next").NextConfig}
 */
const { withBotId } = require("botid/next/config");

function normalizeHost(input) {
  return (input || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function parseHostFromUrl(input) {
  try {
    return new URL(input).host;
  } catch {
    return "";
  }
}

function isLocalHostLike(host) {
  const bareHost = normalizeHost(host).replace(/:\d+$/, "").toLowerCase();
  return (
    bareHost === "localhost" ||
    bareHost.endsWith(".localhost") ||
    bareHost.endsWith(".test")
  );
}

function collectAllowedOrigins() {
  const origins = new Set();
  const rootDomain = normalizeHost(process.env.NEXT_PUBLIC_ROOT_DOMAIN);
  const nextAuthHost = parseHostFromUrl(process.env.NEXTAUTH_URL || "");
  const nextAuthPort = (() => {
    try {
      return new URL(process.env.NEXTAUTH_URL || "").port;
    } catch {
      return "";
    }
  })();

  if (nextAuthHost) origins.add(nextAuthHost);

  if (rootDomain) {
    const rootHasPort = /:\d+$/.test(rootDomain);
    const rootHostOnly = rootDomain.replace(/:\d+$/, "");
    const localLike = isLocalHostLike(rootDomain);
    const portSuffix = !rootHasPort && localLike && nextAuthPort ? `:${nextAuthPort}` : "";

    origins.add(rootHasPort ? rootDomain : `${rootHostOnly}${portSuffix}`);
    origins.add(`app.${rootHostOnly}${portSuffix}`);
  }

  return [...origins].filter(Boolean);
}

const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  experimental: {
    serverActions: {
      allowedOrigins: collectAllowedOrigins(),
      bodySizeLimit: "50mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.s3.amazonaws.com",
      },
      { hostname: "public.blob.vercel-storage.com" },
      { hostname: "res.cloudinary.com" },
      { hostname: "abs.twimg.com" },
      { hostname: "pbs.twimg.com" },
      { hostname: "avatar.vercel.sh" },
      { hostname: "avatars.githubusercontent.com" },
      { hostname: "www.google.com" },
      { hostname: "flag.vercel.app" },
      { hostname: "illustrations.popsy.co" },
    ],
  },
};

module.exports = withBotId(nextConfig);
