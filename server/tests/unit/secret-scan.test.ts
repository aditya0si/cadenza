import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * `scripts/secret_scan.sh` is a gate, so it is tested like one: the committed
 * tree must scan clean, and every check must be *able* to fail. A check that
 * cannot fail is not a gate — it is decoration.
 *
 * The canary values below are assembled at runtime instead of being written as
 * literals, because this file is itself scanned by the very script under test
 * (a literal here would make the repo's own scan red).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const scanScript = path.join(repoRoot, 'scripts', 'secret_scan.sh');

interface ScanResult {
  status: number;
  output: string;
}

const runScan = (cwd: string): ScanResult => {
  try {
    const output = execFileSync('bash', [path.join(cwd, 'scripts', 'secret_scan.sh')], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number | null; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
};

const scratchDirs: string[] = [];

/** A throwaway git repo holding the scan script plus the given files. */
const scratchRepo = (files: Record<string, string>): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cadenza-scan-'));
  scratchDirs.push(dir);
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  writeFileSync(path.join(dir, 'scripts', 'secret_scan.sh'), readFileSync(scanScript, 'utf8'));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
};

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe('secret scan', () => {
  it('is clean on the committed tree', () => {
    const result = runScan(repoRoot);
    expect(result.output).toContain('secret scan clean');
    expect(result.status).toBe(0);
  });

  it('fails check 1 when a real .env file is tracked', () => {
    const dir = scratchRepo({ 'server/.env': 'PORT=4000\n' });
    const result = runScan(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain('a real .env file is tracked');
    expect(result.output).toContain('server/.env');
  });

  it('fails check 2 on a provider-shaped credential', () => {
    const stripeKey = ['sk', 'live', 'a'.repeat(24)].join('_');
    const dir = scratchRepo({ 'src/config.ts': `export const stripeKey = '${stripeKey}';\n` });
    const result = runScan(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain('a provider-shaped credential is committed');
  });

  it('fails check 3 on an upper-case and a camel-case secret name', () => {
    const literal = '0123456789abcdefghij';
    const upper = scratchRepo({ 'src/env.ts': `const API_KEY = "${literal}";\n` });
    const upperResult = runScan(upper);
    expect(upperResult.status).toBe(1);
    expect(upperResult.output).toContain('a hardcoded literal secret is committed');

    const camel = scratchRepo({ 'src/env.ts': `const signingSecret = "${literal}";\n` });
    const camelResult = runScan(camel);
    expect(camelResult.status).toBe(1);
    expect(camelResult.output).toContain('a hardcoded literal secret is committed');
  });

  it('fails check 3 for a doc or .example file, not just source', () => {
    const literal = 'abcdefghijklmnopqrstuvwx';
    const docs = scratchRepo({ 'README.md': `The old value was token = "${literal}" before rotation.\n` });
    const docsResult = runScan(docs);
    expect(docsResult.status).toBe(1);
    expect(docsResult.output).toContain('README.md');

    const example = scratchRepo({ '.env.example': `SIGNING_SECRET="${literal}"\n` });
    const exampleResult = runScan(example);
    expect(exampleResult.status).toBe(1);
    expect(exampleResult.output).toContain('.env.example');
  });

  it('runs every check in one pass instead of stopping at the first failure', () => {
    const literal = 'zyxwvutsrqponmlkjihgfedc';
    const dir = scratchRepo({
      'server/.env': 'PORT=4000\n',
      'src/env.ts': `const SIGNING_SECRET = "${literal}";\n`,
    });
    const result = runScan(dir);
    expect(result.status).toBe(1);
    // Both the .env failure (check 1) and the literal failure (check 3) are
    // reported by the same run: an earlier failure does not hide a later one.
    expect(result.output).toContain('a real .env file is tracked');
    expect(result.output).toContain('a hardcoded literal secret is committed');
    expect(result.output).toContain('secret scan FAILED');
  });
});
