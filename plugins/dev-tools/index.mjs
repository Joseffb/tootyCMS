export async function register(kernel, api) {
  kernel.addAction("render:before", () => {
    // Hook exists for plugin lifecycle side effects.
  });

  kernel.addFilter("nav:items", (items, context) => {
    if (context?.location !== "header") return items;
    return items;
  });

  kernel.addFilter("admin:environment-badge", async (current, context = {}) => {
    const environment = context?.environment === "development" ? "development" : "production";
    const developmentLabel = (await api?.getPluginSetting("developmentLabel", "Development")) || "Development";
    const productionLabel = (await api?.getPluginSetting("productionLabel", "Production")) || "Production";
    return {
      show: true,
      label: environment === "development" ? developmentLabel : productionLabel,
      environment,
    };
  });
}
