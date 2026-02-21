export async function register(kernel, api) {
  kernel.addAction("render:before", () => {
    // Hook exists for plugin lifecycle side effects.
  });

  kernel.addFilter("nav:items", (items, context) => {
    if (context?.location !== "header") return items;
    return items;
  });

  // Example internal API usage (no REST required).
  await api?.setPluginSetting("last_loaded_at", new Date().toISOString());
}
