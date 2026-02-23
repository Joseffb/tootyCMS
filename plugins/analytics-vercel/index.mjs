export async function register(kernel, api) {
  kernel.addFilter("analytics:scripts", async (current = []) => {
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
