export async function register(kernel, api) {
  kernel.addAction("request:begin", (context = {}) => {
    if (!context.debug) return;
    context.trace = [...(context.trace || []), "hello-hamilton: Those who stand for nothing fall for anything."];
  }, 30);

  await api?.setPluginSetting("quote_source", "Hamilton");
}
