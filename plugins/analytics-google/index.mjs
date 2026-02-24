function envTagId() {
  return String(
    process.env.ANALYTICS_GOOGLE_TAG_ID || process.env.ANALYTICS_GOOGLE_MEASUREMENT_ID || "",
  ).trim();
}

function envDeveloperId() {
  return String(process.env.ANALYTICS_GOOGLE_DEVELOPER_ID || "").trim();
}

export async function register(kernel, api) {
  kernel.addFilter("analytics:scripts", async (current = []) => {
    const configuredTagId = String(
      (await api?.getPluginSetting?.("tagId", "")) ||
        (await api?.getPluginSetting?.("measurementId", "")) ||
        envTagId(),
    ).trim();
    if (!configuredTagId) return current;

    const developerId = String(
      (await api?.getPluginSetting?.("developerId", envDeveloperId())) || "",
    ).trim();
    const developerInit = developerId
      ? `gtag('set', {'developer_id.${developerId}': true}); `
      : "";

    return [
      ...current,
      {
        id: "analytics-google-sdk",
        src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(configuredTagId)}`,
        strategy: "afterInteractive",
      },
      {
        id: "analytics-google-init",
        strategy: "afterInteractive",
        inline:
          "window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); " +
          developerInit +
          "gtag('config', '" +
          configuredTagId +
          "');",
      },
    ];
  });
}
