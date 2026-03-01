export async function register(kernel) {
  // Pre-v1: consent enforcement remains core-owned (`privacy-consent`).
  // This first-party plugin currently exists as the site-level UX/config shell.
  kernel.addFilter("domain:scripts", (current = []) => current);
}
