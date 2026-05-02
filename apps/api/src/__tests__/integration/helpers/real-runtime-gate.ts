import { describe } from 'vitest';

/**
 * Wraps `describe` so that tests requiring a real container runtime (Docker /
 * Podman) only run when `RUN_REAL_RUNTIME_TESTS=1` is set. The default
 * integration suite is fully hermetic via MockRuntime; real-runtime tests are
 * opt-in for local devs with Docker available and for the dedicated CI job.
 *
 * Usage:
 *
 *   describeIfRealRuntime('Files tools integration', () => { ... });
 *
 * Without the env var, the whole describe block is skipped — preventing
 * 20+-minute hangs in environments where Docker/Podman is unavailable.
 */
const SHOULD_SKIP = process.env.RUN_REAL_RUNTIME_TESTS !== '1';

export function describeIfRealRuntime(name: string, fn: () => void): void {
  if (SHOULD_SKIP) {
    describe.skip(name, fn);
    return;
  }
  describe(name, fn);
}
