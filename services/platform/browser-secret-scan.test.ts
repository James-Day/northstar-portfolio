import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanBrowserOutput } from '../../scripts/browser-secret-scan';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'portfolio-browser-secret-scan-'));
  temporaryDirectories.push(root);
  await writeFile(join(root, 'app.js'), content, 'utf8');
  return root;
}

describe('scanBrowserOutput', () => {
  it('returns no findings for browser-safe output', async () => {
    const root = await fixture(
      'const publicUrl = "https://example.supabase.co";',
    );
    await expect(
      scanBrowserOutput(root, ['service-secret-value']),
    ).resolves.toEqual([]);
  });

  it('reports secret names and configured values without exposing content', async () => {
    const root = await fixture(
      'const key = "SUPABASE_SERVICE_ROLE_KEY"; const value = "service-secret-value";',
    );
    await expect(
      scanBrowserOutput(root, ['service-secret-value']),
    ).resolves.toEqual([
      { file: 'app.js', rule: 'service-role-key-name' },
      { file: 'app.js', rule: 'configured-secret-value' },
    ]);
  });

  it('detects provider credential formats and private key material', async () => {
    const root = await fixture(
      'sk_live_example whsec_example -----BEGIN PRIVATE KEY-----',
    );
    const findings = await scanBrowserOutput(root);
    expect(findings.map(({ rule }) => rule)).toEqual([
      'private-key-material',
      'stripe-secret-prefix',
      'stripe-webhook-secret-prefix',
    ]);
  });
});
