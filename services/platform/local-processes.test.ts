import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { boundedRedactedOutput, redactProcessOutput, waitForLocalHttp } from '../../scripts/local-processes';

describe('local process harness contracts', () => {
  it('redacts credentials and bearer tokens from captured output', () => {
    expect(redactProcessOutput('SERVICE_ROLE_KEY=secret-value Bearer abc.def.ghi', ['secret-value']))
      .toBe('SERVICE_ROLE_KEY=[REDACTED] Bearer [REDACTED]');
  });

  it('bounds redacted CLI diagnostics while retaining the newest failure lines', () => {
    const output = ['SERVICE_ROLE_KEY=secret-value', 'old diagnostic', 'another diagnostic', 'latest failure'].join('\n');
    expect(boundedRedactedOutput(output, ['secret-value'], 2)).toBe('[diagnostics truncated to 2 lines]\nanother diagnostic\nlatest failure');
  });

  it('waits for a process endpoint and reports captured output on early exit', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null as number | null }) as unknown as ChildProcess;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok', { status: 200 }));
    await expect(waitForLocalHttp({ url: 'http://localhost:8787/health', child, output: () => 'ready' }, fetcher, { attempts: 1, delayMs: 0 })).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith('http://localhost:8787/health');
    (child as ChildProcess & { exitCode: number | null }).exitCode = 1;
    await expect(waitForLocalHttp({ url: 'http://localhost:8787/health', child, output: () => 'crashed' }, vi.fn(), { attempts: 1, delayMs: 0 })).rejects.toThrow('crashed');
  });
});
