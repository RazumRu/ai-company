---
id: devops-agent
name: DevOps Agent
description: Instructions for agents working with Docker, CI/CD pipelines, and infrastructure-as-code
---

## Dockerfile Best Practices
- Use explicit, pinned base image tags (e.g., `node:22.4.0-alpine3.20`). Never use `latest` — it makes builds non-reproducible.
- Use multi-stage builds to separate build tooling from the final runtime image. The final stage should contain only what is needed to run the application.
- Order `COPY` and `RUN` instructions from least-frequently-changed to most-frequently-changed to maximize layer cache reuse. Copy dependency manifests and install before copying source code.
- Run application processes as a non-root user. Create a dedicated user in the Dockerfile; do not rely on the base image's root user.
- Combine related `RUN` commands with `&&` and clean up caches in the same layer (e.g., `apt-get clean && rm -rf /var/lib/apt/lists/*`) to keep image layers small.
- Use `.dockerignore` to exclude build artifacts, test files, secrets, and local environment files from the build context.
- Set `WORKDIR` explicitly. Do not rely on implicit working directories.
- Prefer `COPY` over `ADD` unless you specifically need URL fetching or automatic tar extraction.
- Use `ENTRYPOINT` for the main process and `CMD` for default arguments that callers may override.

## Container Security
- Scan images for known CVEs as part of the build pipeline. Block promotion if critical vulnerabilities are found.
- Never bake secrets, credentials, API keys, or environment-specific config into image layers. Use runtime secret injection (environment variables, mounted secret volumes, or a secrets manager).
- Avoid running with `--privileged` or mounting the Docker socket into containers unless the workload explicitly requires it, and document why.
- Set resource limits (`--memory`, `--cpus`) on production containers to prevent noisy-neighbour problems.
- Use read-only filesystems (`--read-only`) where the application does not need to write to disk; mount writable volumes only where needed.

## CI/CD Pipeline Design
- Pipelines must be reproducible: the same commit must produce the same artefact on every run.
- Fail fast: run the cheapest checks (lint, type-check, unit tests) before expensive ones (integration tests, builds, deployments).
- Every stage that produces an artefact must tag or version it deterministically — never overwrite a published artefact with a new build of the same tag.
- Gate deployments to production behind at least one explicit approval step or a green integration-test signal.
- Keep pipeline definitions in version control alongside the application code. Never configure pipelines manually through a UI without a code equivalent.
- Cache dependency installation layers between runs (node_modules, pip cache, Go module cache, etc.) to reduce build times. Invalidate the cache when the lockfile changes.
- Use dedicated service containers or in-pipeline stubs for databases, queues, and external services in tests — never connect to shared production infrastructure from CI.

## Secrets Management
- Never commit secrets to version control. This includes `.env` files, private keys, tokens, and passwords.
- Use the platform's native secret store (CI/CD secret variables, cloud provider secret manager, Vault) rather than encoding secrets as base64 or hiding them in build arguments.
- Rotate secrets on schedule and immediately after any suspected compromise.
- Audit which pipeline jobs have access to which secrets. Apply least-privilege: a job that only runs tests does not need deployment credentials.
- Mask secrets in log output. Verify that the CI platform redacts secret variable values from printed output.

## Infrastructure as Code
- All infrastructure must be described in code and version-controlled. No manual changes to production resources without a corresponding IaC update.
- Use modules/reusable components to avoid duplicating resource definitions across environments.
- Keep environment-specific values (instance sizes, replica counts, domain names) in environment-specific variable files, not hardcoded in module definitions.
- Plan before apply: always review the diff of proposed infrastructure changes before executing them.
- State files that contain sensitive outputs (Terraform state, etc.) must be stored remotely with access controls and encryption at rest. Never commit state files.
- Tag all cloud resources with owner, environment, and cost-centre metadata.

## Deployment Safety
- Use rolling deployments or blue/green strategies to avoid downtime. Never deploy by stopping all instances simultaneously.
- Define readiness and liveness probes for every containerised service. A container that passes its health check is the only signal the orchestrator uses to route traffic.
- Always have a tested rollback procedure. Know how to revert to the previous version in under five minutes.
- Deploy to a staging environment that mirrors production before deploying to production.
- Use feature flags for high-risk changes so that the deployed code can be toggled without a new deployment.
- Set deployment timeouts. A deployment that does not complete within a defined window should roll back automatically.

## Observability Requirements
- Every deployed service must emit structured logs, expose a health/readiness endpoint, and export metrics.
- Configure alerts for error rate, latency, and saturation before a service reaches production — not after the first incident.
- Ensure log aggregation and metric collection are in place before a service is promoted, not retrofitted later.

## Quality Gate
1. Docker images build successfully in CI and pass vulnerability scanning with no critical CVEs unaddressed.
2. All pipeline stages pass on the target branch before merge to the main branch.
3. No secrets appear in version control, build logs, or image layers.
4. IaC plan produces no unintended resource deletions or replacements.
5. Deployment health checks pass and rollback procedure is documented.
