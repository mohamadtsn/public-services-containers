import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { beforeEach } from 'vitest';

/**
 * Safety rail. A production stack runs on developer machines from a real
 * PUBSERVICES_HOME (and, for v1 installs, /usr/local/lib/public-services-containers).
 * No test may ever resolve to a path outside the OS temp directory — a stray
 * ensureHome() or reset() against the real home would destroy live data.
 */
const TMP = resolve(tmpdir());
const FORBIDDEN = [/^\/usr\/local\/lib\/public-services-containers/, /\.pubservices$/];

function assertSafe(value: string | undefined): void {
  if (!value) return;
  const path = resolve(value);
  if (!path.startsWith(TMP) || FORBIDDEN.some((re) => re.test(path))) {
    throw new Error(
      `Refusing to run tests against a non-temporary PUBSERVICES_HOME: ${path}\n` +
        `Tests must use mkdtempSync(join(tmpdir(), ...)) only.`,
    );
  }
}

beforeEach(() => {
  assertSafe(process.env['PUBSERVICES_HOME']);
});

// Guard the default too: if a test forgets to pass a home, it must not fall
// back to ~/.pubservices. Point the default at a temp path for the whole run.
process.env['PUBSERVICES_HOME'] ??= resolve(TMP, 'pubservices-vitest-default');
assertSafe(process.env['PUBSERVICES_HOME']);
