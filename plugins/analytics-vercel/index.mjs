export async function register(kernel) {
  kernel.addFilter("analytics:scripts", (current = []) => {
    const enabled = String(process.env.ANALYTICS_VERCEL_ENABLED || "").trim().toLowerCase();
    if (!["1", "true", "yes", "on"].includes(enabled)) return current;
    return [
      ...current,
      {
        id: "analytics-vercel-sdk",
        src: "/_vercel/insights/script.js",
        strategy: "afterInteractive",
      },
    ];
  });
}
