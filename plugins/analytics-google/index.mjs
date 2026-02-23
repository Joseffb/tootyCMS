export async function register(kernel) {
  kernel.addFilter("analytics:scripts", (current = []) => {
    const measurementId = String(process.env.ANALYTICS_GOOGLE_MEASUREMENT_ID || "").trim();
    const enabled = String(process.env.ANALYTICS_GOOGLE_ENABLED || "").trim().toLowerCase();
    if (!measurementId || !["1", "true", "yes", "on"].includes(enabled)) return current;
    return [
      ...current,
      {
        id: "analytics-google-sdk",
        src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`,
        strategy: "afterInteractive",
      },
      {
        id: "analytics-google-init",
        strategy: "afterInteractive",
        inline:
          "window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', '" +
          measurementId +
          "');",
      },
    ];
  });
}
