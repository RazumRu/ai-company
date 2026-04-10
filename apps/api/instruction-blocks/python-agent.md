---
id: python-agent
name: Python Agent
description: Instructions for agents working with Python codebases
---

## Type Hints
- Annotate all function signatures — parameters and return types. Unannotated code is harder to reason about and breaks static analysis.
- Never use bare `Any` from `typing`. Use specific types, `TypeVar`, generics, or `object` with `isinstance` guards.
- Use `X | None` (Python 3.10+) or `Optional[X]` for nullable values. Use `X | None` as the default unless the project targets an older runtime.
- Derive types from Pydantic models or dataclasses via inference rather than duplicating shapes as separate `TypedDict` or plain `dict` annotations.
- Run `mypy` or `pyright` as part of the quality gate. Fix all type errors; never add `type: ignore` without a comment explaining why.

## Code Style
- Follow PEP 8. Use the project's configured formatter (Black, Ruff, or autopep8) — never reformat selectively.
- Maximum line length is whatever the project's formatter enforces. Do not override it inline.
- Use snake_case for variables, functions, and modules. Use PascalCase for classes. Use UPPER_SNAKE_CASE for module-level constants.
- Remove dead code immediately. Remove comments that restate what code does; keep comments that explain why.

## Error Handling
- Catch specific exception types. Bare `except:` and `except Exception:` without re-raise are forbidden.
- Never swallow exceptions silently. Log or re-raise at every catch site.
- Use custom exception classes that inherit from a project base exception rather than raising raw `ValueError`/`RuntimeError` at domain boundaries.
- Use `contextlib.suppress` only for genuinely ignorable errors, not as a shortcut for lazy error handling.

## Module and Package Organization
- One public concept per module. Do not create god modules that export dozens of unrelated symbols.
- Keep `__init__.py` files minimal — re-export only the stable public API, not internal implementation details.
- Separate concerns: IO, business logic, and data models should not live in the same file.
- Avoid circular imports. If two modules need each other, extract the shared dependency into a third module.

## Virtual Environments and Dependency Management
- Use whichever tool the project already uses (pip + venv, Poetry, PDM, uv). Check for `pyproject.toml`, `Pipfile`, or `requirements*.txt` to determine the correct tool.
- Never install packages globally when a project environment exists.
- Pin transitive dependencies in lockfiles (`poetry.lock`, `pdm.lock`, `uv.lock`). Do not hand-edit lockfiles.
- Separate runtime and development dependencies (e.g., `[tool.poetry.dev-dependencies]` or `requirements-dev.txt`).

## Async Patterns
- Never mix sync blocking calls inside `async def` functions. Use async-compatible libraries or `asyncio.to_thread` for blocking IO.
- Always `await` coroutines. Unawaited coroutines are silent no-ops.
- Use `asyncio.gather` for concurrent tasks; use `asyncio.TaskGroup` (Python 3.11+) for structured concurrency with automatic cancellation.
- Avoid `asyncio.get_event_loop()` in library code; accept or create loops explicitly.

## Testing
- Use `pytest`. Name test files `test_*.py` or `*_test.py` and place them in a `tests/` directory mirroring the source layout.
- Use `pytest.fixture` for shared setup. Prefer function-scoped fixtures unless broader scope is explicitly needed.
- Mock external IO (network, filesystem, databases) at the boundary. Use `pytest-mock` or `unittest.mock.patch`.
- Parametrize repetitive cases with `@pytest.mark.parametrize` rather than duplicating test functions.
- Run tests using the project's configured script. Never invoke `pytest` directly in a way that bypasses project configuration.
- Never use `pytest.skip` or `pytest.xfail` to hide failing tests. Fix the test or the code.

## Design Patterns
- Prefer functions over classes for stateless transformations.
- Use dataclasses or Pydantic models for data containers — not plain dicts passed between functions.
- Use dependency injection (pass dependencies as arguments) rather than importing globals or using module-level singletons in business logic.
- Avoid mutable default arguments (`def f(x=[])` is a well-known Python trap — use `None` and assign inside).

## Logging
- Use the `logging` module with named loggers (`logging.getLogger(__name__)`). Never use `print` for operational output.
- Log at the appropriate level: `DEBUG` for diagnostics, `INFO` for lifecycle events, `WARNING` for recoverable anomalies, `ERROR` for failures.
- Never log secrets, tokens, or PII.

## Quality Gate
1. `mypy` or `pyright` reports no errors.
2. All tests pass via the project's test script.
3. Formatter and linter report no issues.
4. No bare `except`, swallowed exceptions, `Any` types, or `type: ignore` without explanation.
5. No dead code, no `print` statements in production paths, no hardcoded secrets.
