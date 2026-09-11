import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

export type LocalProcessSpec = {
  name: string;
  command: string;
  args: string[];
  url: string;
};

export type LocalProcessHandle = {
  name: string;
  pid: number;
  url: string;
  child: ChildProcess;
  output: () => string;
  stop: () => Promise<void>;
};

export type LocalProcessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  output?: (line: string) => void;
  maxOutputLines?: number;
};

const DEFAULT_OUTPUT_LINES = 80;

/** Redacts credentials before process output reaches the terminal or an error. */
export function redactProcessOutput(value: string, secrets: string[] = []): string {
  let redacted = value;
  for (const secret of secrets.filter((candidate) => candidate.length >= 6)) {
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted
    .replace(/((?:service[_-]?role|anon|access|refresh|marketstack)[_-]?key\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');
}

/** Keeps CLI failure diagnostics useful without allowing unbounded or secret-bearing output. */
export function boundedRedactedOutput(value: string, secrets: string[] = [], maxLines = DEFAULT_OUTPUT_LINES): string {
  const lines = redactProcessOutput(value, secrets).split(/\r?\n/).filter(Boolean);
  if (lines.length <= maxLines) return lines.join('\n');
  return [`[diagnostics truncated to ${maxLines} lines]`, ...lines.slice(-maxLines)].join('\n');
}

function executableFor(command: string): string {
  if (process.platform !== 'win32') return command;
  return command === 'npm' ? 'npm.cmd' : command;
}

function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return Promise.resolve();
  if (process.platform === 'win32' && child.pid) {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    if (result.status === 0 || child.exitCode !== null) return Promise.resolve();
  }
  child.kill('SIGTERM');
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 2_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

export function startLocalProcess(spec: LocalProcessSpec, options: LocalProcessOptions = {}): LocalProcessHandle {
  const lines: string[] = [];
  const maxOutputLines = options.maxOutputLines ?? DEFAULT_OUTPUT_LINES;
  const child = spawn(executableFor(spec.command), spec.args, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const capture = (chunk: Buffer | string) => {
    const text = redactProcessOutput(String(chunk), Object.values(options.env ?? {}).filter((value): value is string => Boolean(value)));
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      lines.push(line);
      if (lines.length > maxOutputLines) lines.shift();
      options.output?.(`[${spec.name}] ${line}`);
    }
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const handle: LocalProcessHandle = {
    name: spec.name,
    pid: child.pid ?? -1,
    url: spec.url,
    child,
    output: () => lines.join('\n'),
    stop: () => terminateChild(child),
  };
  child.once('error', (error) => capture(`process error: ${error.message}`));
  return handle;
}

export async function waitForLocalHttp(
  handle: Pick<LocalProcessHandle, 'url' | 'child' | 'output'>,
  fetcher: typeof fetch = fetch,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? 30;
  const delayMs = options.delayMs ?? 500;
  let lastError = 'no response';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (handle.child.exitCode !== null) {
      throw new Error(`Local process exited before ${handle.url} became ready: ${handle.output() || 'no captured output'}`);
    }
    try {
      const response = await fetcher(handle.url);
      if (response.ok || response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Local process ${handle.url} did not become ready (${lastError}). Output: ${handle.output() || 'none'}`);
}

export async function stopLocalProcesses(handles: LocalProcessHandle[]): Promise<void> {
  for (const handle of [...handles].reverse()) await handle.stop();
}
