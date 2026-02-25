export type SecretFinding = {
  file: string;
  line: number;
  rule: string;
  snippet: string;
};

type SecretRule = {
  id: string;
  regex: RegExp;
};

const RULES: SecretRule[] = [
  { id: "private-key", regex: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i },
  { id: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { id: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    id: "generic-secret-assignment",
    regex: /\b(api[_-]?key|secret|token|password|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_\-\/+=.]{16,})["']?/i,
  },
  { id: "bearer-token", regex: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*\b/i },
];

const SAFE_VALUE_HINTS = /(example|sample|dummy|test|fake|changeme|your_|xxxxx|<[^>]+>)/i;
const SAFE_FILE_HINTS = /(^|\/)(docs\/|README|CHANGELOG|LICENSE|\.env\.example$|\.md$)/i;

export function shouldSkipFilePath(path: string) {
  return (
    /(^|\/)(node_modules|\.next|coverage|dist|build|out|test-results|logs)\//.test(path) ||
    /\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|zip|gz|tgz|woff2?|ttf|eot)$/i.test(path)
  );
}

export function scanTextForSecrets(file: string, text: string): SecretFinding[] {
  const lines = text.split(/\r?\n/);
  const findings: SecretFinding[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || "";
    if (!line.trim()) continue;
    if (SAFE_FILE_HINTS.test(file) && SAFE_VALUE_HINTS.test(line)) continue;

    for (const rule of RULES) {
      const matched = rule.regex.exec(line);
      if (!matched) continue;
      const token = matched[2] || matched[0] || "";
      if (token.length < 16) continue;
      if (/^[A-Z0-9_]+$/.test(token)) continue;
      if (token.includes("process.env.")) continue;
      if (SAFE_VALUE_HINTS.test(token)) continue;

      findings.push({
        file,
        line: i + 1,
        rule: rule.id,
        snippet: line.trim().slice(0, 200),
      });
    }
  }

  return findings;
}
