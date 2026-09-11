import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('local integration Worker configuration', () => {
  it('keeps Windows HTTP smoke separate from deployment queue and Durable Object bindings', async () => {
    const config = await readFile(new URL('../../wrangler.api.local.toml', import.meta.url), 'utf8');
    const harness = await readFile(new URL('../../scripts/local-integration.ts', import.meta.url), 'utf8');

    expect(harness).toContain("'wrangler.api.local.toml'");
    expect(config).toContain('name = "northstar-portfolio-api-local"');
    expect(config).not.toContain('[[queues.consumers]]');
    expect(config).not.toContain('[[durable_objects.bindings]]');
    expect(config).not.toContain('[triggers]');
  });
});
