function isEnabledValue(raw, fallback = false) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function envEnabled() {
  return isEnabledValue(process.env.ANALYTICS_VERCEL_ENABLED, false);
}

export async function register(kernel, api) {
  kernel.addFilter("analytics:scripts", async (current = []) => {
    const enabledRaw = await api?.getPluginSetting?.("enabled", String(envEnabled()));
    if (!isEnabledValue(enabledRaw, envEnabled())) return current;

    return [
      ...current,
      {
        id: "analytics-vercel-bootstrap",
        strategy: "afterInteractive",
        inline:
          "window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};",
      },
      {
        id: "analytics-vercel-sdk",
        src: "/_vercel/insights/script.js",
        strategy: "afterInteractive",
      },
    ];
  });
}
