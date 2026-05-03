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
const SHOULD_SKIP_REAL_RUNTIME = process.env.RUN_REAL_RUNTIME_TESTS !== '1';

export function describeIfRealRuntime(name: string, fn: () => void): void {
  if (SHOULD_SKIP_REAL_RUNTIME) {
    describe.skip(name, fn);
    return;
  }
  describe(name, fn);
}

/**
 * Skip Daytona-backed integration tests unless `RUN_REAL_DAYTONA_TESTS=1` AND
 * `DAYTONA_API_URL` / `DAYTONA_API_KEY` are explicitly set in the environment
 * (i.e. the caller did not fall back to development defaults baked into
 * `environment.dev.ts`). The default integration suite has no Daytona service
 * to talk to, so failing these tests as "must-fail by design" is misleading;
 * gating them keeps `pnpm test:integration` clean while preserving an opt-in
 * path for the Daytona-enabled CI lane / local devs.
 */
const SHOULD_RUN_DAYTONA =
  process.env.RUN_REAL_DAYTONA_TESTS === '1' &&
  Boolean(process.env.DAYTONA_API_URL) &&
  Boolean(process.env.DAYTONA_API_KEY);

export function describeIfRealDaytona(name: string, fn: () => void): void {
  if (!SHOULD_RUN_DAYTONA) {
    describe.skip(name, fn);
    return;
  }
  describe(name, fn);
}

/**
 * Skip Kubernetes-backed integration tests unless either `K8S_IN_CLUSTER=true`
 * (running inside a pod) or `KUBECONFIG` points at a reachable cluster, AND
 * `RUN_REAL_K8S_TESTS=1` is set as the explicit opt-in. K8s tests need a
 * cluster + namespace + RBAC; they're useful for the K8s-enabled CI lane but
 * not for vanilla `pnpm test:integration`.
 */
const SHOULD_RUN_K8S =
  process.env.RUN_REAL_K8S_TESTS === '1' &&
  (process.env.K8S_IN_CLUSTER === 'true' || Boolean(process.env.KUBECONFIG));

export function describeIfRealK8s(name: string, fn: () => void): void {
  if (!SHOULD_RUN_K8S) {
    describe.skip(name, fn);
    return;
  }
  describe(name, fn);
}
