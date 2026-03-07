import net from "node:net";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

function normalizePort(input) {
  const parsed = Number.parseInt(String(input || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 3000;
  return parsed;
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.on("error", () => {
      resolve(false);
    });

    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

function hasActiveTestSlotLock(port) {
  const normalized = normalizePort(port);
  const candidateLocks = [
    `.next-test-${normalized}/lock`,
    `.next-playwright-harness-${normalized}/lock`,
  ];
  return candidateLocks.some((candidate) => fs.existsSync(candidate));
}

export async function resolveTestPort(preferredPort = 3000, maxAttempts = 50) {
  let port = normalizePort(preferredPort);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (!hasActiveTestSlotLock(port) && (await canListenOnPort(port))) return port;
    port += 1;
  }
  throw new Error(`Unable to find an open test port after ${maxAttempts} attempts starting at ${preferredPort}.`);
}

async function main() {
  const port = await resolveTestPort(process.argv[2] || "3123");
  process.stdout.write(String(port));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
