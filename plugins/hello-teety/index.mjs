export async function register(kernel, api) {
  const defaultQuotes = [
    "Yep. Here. Still breathing.",
    "Crisis survived. Barely.",
    "Cool story. Next.",
    "I'll notice — eventually.",
    "Actually, that happened on purpose.",
    "Bold choice — and you lived.",
    "No panic. Just coffee. Lots of coffee.",
    "Looks expensive. Buy another!",
    "Ok I blinked — it passed.",
    "Nice mess. You're gonna clean it right?",
    "And... we call that progress.",
    "Accidental genius counts too.",
    "Oddly, that worked.",
    "Surely, you aren't serious. On second thought, why not.",
    "At least it broke politely.",
    "And NOW it behaves.",
    "Tiny win. I'll allow it.",
    "Low effort, high legend.",
    "Mediocre plan, great ending.",
    "Honestly, I expected worse.",
    "Yay! Nothing exploded today.",
    "Suspiciously functional.",
    "Awesome. That fixed itself.",
    "Confidence there was unjustified.",
    "Luck loves this team.",
    "And... we got away with it.",
    "Disaster postponed.",
    "That bug retired.",
    "Unclear why, but stable.",
    "Good enough — for humans.",
    "Still cursed, still useful.",
    "Let's call this acceptable.",
    "Miracles have expirations you know.",
    "It's fine... ish.",
    "Zero grace, full success.",
    "Messy, yet unavoidable.",
    "Somehow still employed.",
    "A win is a win and that's all a win is.",
    "Embarrassing yet effective.",
    "Hilariously correct.",
    "No notes, just anecdotes.",
    "The gremlins are quiet today.",
    "Today we survive elegance.",
    "Rough edges, smooth outcome.",
    "It passes the vibe.",
    "I laughed, then cried.",
    "Broken yesterday, iconic today.",
    "Questionable, yet not fatal.",
    "System panic canceled.",
    "Still weird, still right.",
    "We fail forward.",
    "Stability by coincidence.",
    "You call that bad? I've seen worse.",
    "Technically, still alive.",
    "Function over dignity.",
    "Ugly, fast, acceptable.",
    "Not pretty. Productive.",
    "It obeyed us... eventually.",
    "A miracle in dockers.",
    "Don't question the black box. It works.",
    "I did less today. Win.",
    "Minimal effort, maximum folklore.",
    "Nobody saw that bug coming?",
    "Chaos took lunch. Hope it hurries back with my food.",
    "I squeak, then sing.",
    "Barely elegant, fully useful.",
    "Mocked my logic, yet it still works.",
    "Gracefully mediocre.",
    "I pressed save, it shrugged.",
    "Luck did overtime on this deployment.",
    "This should be illegal — let's use 'til we can't.",
    "Unholy, yet reliable.",
    "Odd but obedient.",
    "Duct tape... check.",
    "'Tis a slightly cursed masterpiece.",
    "I cannot explain success.",
    "We shipped a punchline.",
    "Are we the comedian or the heckler?",
    "I doubted, it delivered.",
    "No heroics required.",
    "We recreated the wheel — everyone loves triangles.",
    "It coughed, then sprinted, then died.",
    "Mild chaos, strong finish.",
    "Tense start, clean end.",
    "Small fix, loud results.",
    "Works now. Nobody touch it!",
    "This should not work.",
    "Yet here we are.",
    "Awkward but dependable.",
    "I rolled my eyes, they shipped.",
    "More luck than skill for most of us here.",
    "Still better than expected.",
    "Wildly accepted. Barely legit.",
    "Clunky, but loyal.",
    "We had a bug. The bug lost.",
    "Bare minimum, maximum outcome.",
    "I barely participated.",
    "Outcome says yes. All inputs say no.",
    "Allergic to failure today.",
    "Call it a win.",
  ];

  const themeQuotes = [
    "Tooty Dark looks how I feel: unbothered and dangerous.",
    "Dark mode. Low empathy for nonsense.",
    "Tooty Dark is my face in interface form.",
    "In tooty-dark, even my silence has attitude.",
    "Dark rooms suit honest moods.",
    "Tooty Dark: less sunshine, more truth.",
    "This theme understands my lack of excitement.",
    "Tooty Dark is where I stop pretending to care.",
    "Dark mode on. Small talk off.",
    "Tooty Dark makes my indifference look intentional.",
    "In the dark, my standards glow.",
    "Tooty Dark is my resting expression with better lighting.",
  ];

  const utilityQuotes = [
    "Moving the docs huh?",
    "Sure, refactor first. Regret later.",
    "That comment looked lonely anyway.",
    "You renamed it. Did tests notice?",
    "One tiny tweak. Famous last words.",
    "I felt that merge conflict from here.",
    "Bold commit message. Zero context.",
    "This looked temporary yesterday too.",
    "You changed one line. Twelve files moved.",
    "Looks cleaner. Somehow more dangerous.",
    "You touched routing again?",
    "This branch has trust issues.",
    "Ship it. But like... gently.",
    "Yes, this is technically progress.",
    "Coffee-driven architecture detected.",
  ];

  const asBool = (value, fallback = true) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    return fallback;
  };

  const pickQuote = (quotes) => {
    if (!quotes.length) return defaultQuotes[0];
    const index = Math.floor(Math.random() * quotes.length);
    return quotes[index] || defaultQuotes[0];
  };

  const pickQuotes = (quotes, count) => {
    const pool = Array.isArray(quotes) ? [...quotes] : [];
    const out = [];
    while (pool.length > 0 && out.length < count) {
      const index = Math.floor(Math.random() * pool.length);
      const [picked] = pool.splice(index, 1);
      if (picked) out.push(picked);
    }
    return out;
  };

  const isTweetyContext = (context = {}) => {
    const path = String(context?.path || context?.pathname || "").trim().toLowerCase();
    if (!path) return false;
    if (path.includes("/plugins/export-import")) return true;
    if (path.includes("teety") || path.includes("tweety")) return true;
    return false;
  };

  const isThemeSettingsPath = (context = {}) => {
    const path = String(context?.path || context?.pathname || "").trim().toLowerCase();
    if (!path) return false;
    if (path.includes("/settings/themes")) return true;
    return false;
  };

  const resolveTweetyUseType = (context = {}, siteThemeId = "") => {
    const isDarkTheme = siteThemeId === "teety-dark" || siteThemeId === "tooty-dark";
    if (isDarkTheme && isThemeSettingsPath(context)) return "theme";
    if (isTweetyContext(context)) return "utility";
    return "default";
  };

  kernel.addFilter("admin:context-use-type", async (current = "default", context = {}) => {
    const siteThemeId = await resolveSiteThemeId(context?.siteId);
    const use_type = resolveTweetyUseType(context, siteThemeId);
    return use_type !== "default" ? use_type : current;
  }, 20);

  const resolveSiteThemeId = async (siteId) => {
    if (!siteId) return "";
    const key = `site_${siteId}_theme`;
    return String((await api?.getSetting(key, "")) || "").trim().toLowerCase();
  };

  kernel.addAction(
    "request:begin",
    async (context = {}) => {
      if (!context.debug) return;
      const showInDebug = asBool(await api?.getPluginSetting("showInDebug", "false"), false);
      if (!showInDebug) return;
      const siteThemeId = await resolveSiteThemeId(context?.siteId);
      const use_type = String(context?.use_type || resolveTweetyUseType(context, siteThemeId));
      const traceQuote = use_type === "theme" ? pickQuote(themeQuotes) : use_type === "utility" ? pickQuote(utilityQuotes) : pickQuote(defaultQuotes);
      context.trace = [...(context.trace || []), `hello-teety: ${traceQuote}`];
    },
    30,
  );

  kernel.addFilter("admin:floating-widgets", async (widgets = [], context = {}) => {
    const showWidget = asBool(await api?.getPluginSetting("showWidget", "true"), true);
    if (!showWidget) return widgets;
    const siteThemeId = await resolveSiteThemeId(context?.siteId);
    const use_type = String(context?.use_type || resolveTweetyUseType(context, siteThemeId));
    const is_tweety = use_type === "theme" || use_type === "utility";
    const quote = is_tweety
      ? pickQuotes(use_type === "theme" ? themeQuotes : utilityQuotes, 15).map((line) => `- ${line}`).join("\n")
      : pickQuote(defaultQuotes);
    return [
      ...widgets,
      {
        id: "hello-teety-quote",
        title: "Hello Teety",
        content: quote,
        position: "bottom-right",
      },
    ];
  });
}
