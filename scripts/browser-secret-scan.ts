import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export type BrowserSecretFinding = {
  file: string;
  rule: string;
};

const SECRET_ENV_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'MARKETSTACK_API_KEY',
] as const;

const SECRET_RULES: ReadonlyArray<{ rule: string; pattern: RegExp }> = [
  {
    rule: 'private-key-material',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  },
  {
    rule: 'stripe-secret-prefix',
    pattern: /\bsk_(?:live|test)_[A-Za-z0-9]+\b/,
  },
  { rule: 'stripe-webhook-secret-prefix', pattern: /\bwhsec_[A-Za-z0-9]+\b/ },
  { rule: 'service-role-key-name', pattern: /\bSUPABASE_SERVICE_ROLE_KEY\b/ },
  { rule: 'marketstack-key-name', pattern: /\bMARKETSTACK_API_KEY\b/ },
  {
    rule: 'stripe-secret-key-name',
    pattern: /\bSTRIPE_(?:SECRET_KEY|WEBHOOK_SECRET)\b/,
  },
];

function isTextCandidate(path: string): boolean {
  return /\.(?:css|html?|js|json|map|mjs|txt|svg|xml)$/i.test(path);
}

async function filesUnder(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(root, path)));
    else if (entry.isFile() && isTextCandidate(path)) files.push(path);
  }
  return files.sort();
}

/** Scan only generated browser assets; never prints matching content or secret values. */
export async function scanBrowserOutput(
  root: string,
  secretValues: ReadonlyArray<string> = [],
): Promise<BrowserSecretFinding[]> {
  const values = secretValues.filter((value) => value.trim().length >= 8);
  const files = await filesUnder(root);
  const findings: BrowserSecretFinding[] = [];
  for (const path of files) {
    const source = await readFile(path, 'utf8');
    for (const { rule, pattern } of SECRET_RULES) {
      if (pattern.test(source))
        findings.push({ file: relative(root, path), rule });
    }
    for (const value of values) {
      if (source.includes(value))
        findings.push({
          file: relative(root, path),
          rule: 'configured-secret-value',
        });
    }
  }
  return findings;
}
