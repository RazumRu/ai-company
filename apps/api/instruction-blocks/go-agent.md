---
id: go-agent
name: Go Agent
description: Instructions for agents working with Go codebases
---

## Error Handling
- Always handle errors explicitly. Assigning to `_` for an error return is forbidden unless you have a specific documented reason.
- Return errors upward; wrap them with context using `fmt.Errorf("operation failed: %w", err)` so callers can inspect the chain with `errors.Is` and `errors.As`.
- Define sentinel errors (`var ErrNotFound = errors.New("not found")`) and typed error structs for errors that callers need to handle differently. Use `errors.Is` / `errors.As` to check them — never compare error strings.
- Do not use `panic` for recoverable errors. Reserve `panic` for programming errors (unreachable states, violated invariants) and recover from it only at process boundaries (e.g., HTTP middleware).
- Log errors at the point where they are handled, not at every layer they pass through. Wrapping adds context; logging at every layer creates noise.

## Interfaces
- Define interfaces at the point of use (consumer side), not at the point of implementation. This avoids unnecessary coupling and keeps packages independent.
- Keep interfaces small — one or two methods is often ideal. Large interfaces are hard to mock and hard to satisfy with alternative implementations.
- Do not export an interface just to document that a concrete type implements it. Use `var _ MyInterface = (*MyStruct)(nil)` compile-time assertions where you need an explicit guarantee.
- Accept interfaces; return concrete types. This keeps callers flexible without forcing unnecessary abstraction on callers downstream.

## Goroutines and Concurrency
- Never start a goroutine without a clear owner responsible for its lifetime and a mechanism to signal it to stop (context cancellation, close channel, or WaitGroup).
- Use `context.Context` for cancellation and deadline propagation. Accept a context as the first argument in any function that may block, do IO, or call external services.
- Use channels to communicate between goroutines; use mutexes to protect shared state. Do not mix the two approaches for the same piece of data.
- Close a channel only from the sender side. Closing from the receiver, or closing a nil/already-closed channel, panics.
- Prefer `sync.WaitGroup` for fan-out/fan-in patterns and `errgroup` for concurrent work where any error should cancel the group.
- Avoid goroutine leaks: ensure all goroutines terminate before the program exits or the owning context is done.

## Package Organization
- Keep packages cohesive — one concept per package. Avoid `util`, `common`, or `helpers` packages that accumulate unrelated functions.
- Package names are lowercase, single words, no underscores. The package name is part of the API (e.g., `http.Client`, not `http.HTTPClient`).
- Use `internal/` packages to prevent external consumers from importing implementation details.
- Avoid circular imports. If two packages depend on each other, extract the shared type or interface into a third package.
- `main` packages are entry points only. Business logic must live in importable packages, not `main`.

## Naming
- Use short, descriptive names. Loop variables and receivers can be short (`i`, `r`); exported symbols must be self-documenting.
- Receiver names should be a one or two letter abbreviation of the type — consistent across all methods on that type.
- Acronyms in exported names follow Go convention: `HTTPServer`, `userID`, `parseURL` (all letters uppercase or all lowercase, not mixed).
- Exported symbols must have a doc comment starting with the symbol name: `// Server handles incoming HTTP connections.`

## Go Modules and Dependency Management
- Use `go mod tidy` after adding or removing imports to keep `go.mod` and `go.sum` consistent. Commit both files.
- Pin direct dependencies to explicit versions. Do not use pseudo-versions for dependencies that have tagged releases.
- Prefer the standard library. Add external dependencies only when the standard library genuinely cannot cover the use case.
- Audit new dependencies for maintenance health, licence compatibility, and supply-chain risk before introducing them.

## Testing
- Use the standard `testing` package as the foundation. Table-driven tests (`[]struct{ input, want }`) are the idiomatic pattern for covering multiple cases.
- Test file names end in `_test.go` and live alongside the source file. Black-box tests (package `foo_test`) are preferred for exported APIs; white-box tests (package `foo`) are acceptable for internals.
- Use `t.Helper()` in assertion helpers so failure lines point to the test, not the helper.
- Use `t.Parallel()` in tests that are safe to run concurrently to speed up the test suite.
- Avoid global mutable state in tests. Use test-local setups and clean up in `t.Cleanup`.
- Run tests with the race detector (`-race`) in CI. Fix all detected races before merging.
- Run tests using the project's configured scripts. Never invoke `go test ./...` in a way that bypasses project-level configuration or environment setup.

## Code Style and Formatting
- `gofmt` / `goimports` formatting is mandatory and non-negotiable. Run it before every commit.
- Follow `go vet` and `staticcheck` (or the project's configured linter). Fix all reported issues; never suppress checks without a documented reason.
- Avoid named return values except where they materially improve clarity (e.g., in short functions with multiple returns of the same type). Named returns combined with bare `return` obscure what is being returned.
- Initialise structs with field names (`MyStruct{Field: value}`), not positional (`MyStruct{value}`), for structs with more than one field.

## Quality Gate
1. `go build ./...` succeeds with no errors.
2. All tests pass, including with `-race`.
3. `go vet ./...` and the project's linter report no issues.
4. `go mod tidy` produces no diff.
5. No unhandled errors (`_ = err`), no goroutine leaks detectable in tests, no `panic` in non-invariant paths.
6. All exported symbols have doc comments.
