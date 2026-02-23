export async function register(kernel, api) {
  const defaultQuotes = [
    "Those who stand for nothing fall for anything.",
    "Legacy. What is a legacy? It's planting seeds in a garden you never get to see.",
    "I am not throwing away my shot.",
    "If you stand for nothing, Burr, what'll you fall for?",
    "Dying is easy, young man. Living is harder.",
  ];

  const asBool = (value, fallback = true) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    return fallback;
  };

  const parseQuotes = (raw) => {
    if (!raw) return [];
    return String(raw)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  };

  const pickQuote = (quotes) => {
    if (!quotes.length) return defaultQuotes[0];
    const index = Math.floor(Math.random() * quotes.length);
    return quotes[index] || defaultQuotes[0];
  };

  kernel.addAction(
    "request:begin",
    async (context = {}) => {
      if (!context.debug) return;
      const showInDebug = asBool(await api?.getPluginSetting("showInDebug", "false"), false);
      if (!showInDebug) return;
      context.trace = [...(context.trace || []), "hello-hamilton: Those who stand for nothing fall for anything."];
    },
    30,
  );

  kernel.addFilter("admin:floating-widgets", async (widgets = [], context = {}) => {
    if (!context?.siteId) return widgets;
    const showWidget = asBool(await api?.getPluginSetting("showWidget", "true"), true);
    if (!showWidget) return widgets;
    const customQuotes = parseQuotes(await api?.getPluginSetting("customQuotes", ""));
    const quote = pickQuote(customQuotes.length ? customQuotes : defaultQuotes);
    return [
      ...widgets,
      {
        id: "hello-hamilton-quote",
        title: "Hello Hamilton",
        content: quote,
        position: "bottom-right",
      },
    ];
  });
}
