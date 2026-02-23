export async function register(kernel) {
  // Consent enforcement remains in Core (`privacy-consent`) for now; this plugin
  // exists as the site-level contract owner for consent UX/config migration.
  kernel.addFilter("analytics:scripts", (current = []) => current);
}
