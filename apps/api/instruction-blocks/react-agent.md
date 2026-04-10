---
id: react-agent
name: React Agent
description: Instructions for agents working with React and frontend codebases
---

## Component Design
- Write components as functions. Class components are legacy; do not introduce new ones.
- Keep components small and focused on a single responsibility. A component that renders a list is different from one that fetches it.
- Separate presentational components (pure render, driven by props) from container components (own state, fetch data, coordinate children). Do not mix both concerns in one file unless trivially small.
- Extract reusable UI into a shared component library rather than duplicating markup across pages.

## Props and Types
- Define explicit TypeScript types for all props. Never use `any` or untyped prop objects.
- Use optional props (`prop?`) only when the component genuinely works without them. Document defaults.
- Avoid passing raw object references as props when a stable primitive would suffice — unnecessary object creation triggers re-renders.
- Prefer composition (children, render props, slots) over prop-drilling more than two levels deep.

## Hooks
- Follow the Rules of Hooks: call hooks only at the top level of a function component or custom hook, never inside conditionals or loops.
- Extract repeated hook logic into named custom hooks (`use*`). A custom hook is the right abstraction when the same stateful pattern appears in two or more components.
- `useEffect` dependencies must be complete and accurate. Missing dependencies cause stale closures; unnecessary extras cause infinite loops. Use a linter rule to enforce this.
- Cleanup effects that set up subscriptions, timers, or event listeners by returning a cleanup function from `useEffect`.
- Prefer `useReducer` over `useState` when state transitions involve multiple related values or complex logic.

## State Management
- Keep state as close to where it is used as possible. Lift state only when sibling components genuinely need to share it.
- Use context for truly cross-cutting concerns (auth, theme, locale) — not as a substitute for prop passing.
- Avoid storing derived data in state. Compute it during render or with `useMemo`.
- For server data (fetching, caching, invalidation), use a dedicated data-fetching library rather than manual `useEffect` + `useState` patterns.

## Performance
- Wrap expensive computations in `useMemo`. Wrap callbacks passed to child components in `useCallback` when those children are wrapped in `React.memo`.
- Use `React.memo` on leaf components that render frequently with stable props. Do not memo every component by default — measure first.
- Use `React.lazy` and `Suspense` for code-splitting at route or feature boundaries. Do not lazy-load components that are always needed on initial render.
- Avoid creating new object or array literals in JSX props (e.g., `style={{ ... }}`, `items={[...]}`) — use stable references via `useMemo` or module-level constants.

## Accessibility
- Every interactive element must be keyboard-accessible and have a meaningful accessible name (via `aria-label`, `aria-labelledby`, or visible text).
- Use semantic HTML elements (`button`, `nav`, `main`, `header`, `section`) before reaching for `div` with ARIA roles.
- Images must have `alt` text. Decorative images use `alt=""`.
- Never suppress focus outlines with `outline: none` without providing an alternative visible focus indicator.
- Use `role`, `aria-*`, and `tabIndex` only when semantic HTML does not cover the use case.

## Styling
- Co-locate styles with the component they belong to. Avoid global CSS that reaches into component internals.
- Use the project's established styling approach consistently (CSS modules, utility classes, CSS-in-JS, etc.). Do not introduce a second styling method.
- Never use `dangerouslySetInnerHTML` with unvalidated or user-supplied content.
- Responsive design is a baseline requirement. Components must not assume a fixed viewport width.

## Event Handling
- Prefer event delegation at a natural boundary over attaching individual listeners to many elements.
- Always remove manually attached event listeners in cleanup (via `useEffect` return or `removeEventListener`).
- Debounce or throttle handlers for high-frequency events (scroll, resize, input) using a stable utility.

## Testing
- Test behaviour from the user's perspective, not implementation details. Query by accessible roles, labels, and text — not by class names or internal state.
- Use the project's configured testing library and scripts. Never invoke test runners directly.
- Mock network requests at the boundary (service layer or fetch/XHR) rather than mocking React internals.
- Cover interaction flows (click, type, submit) and error/loading states, not just the happy path.
- Avoid testing implementation details: do not assert on component state, refs, or internal method calls.

## File Conventions
| File type | Extension |
|---|---|
| React component | `.tsx` |
| Non-JSX TypeScript | `.ts` |
| Component styles (CSS modules) | `*.module.css` |
| Unit / component tests | `*.spec.tsx` or `*.test.tsx` |

## Quality Gate
1. TypeScript compiles with no errors.
2. All component and unit tests pass.
3. Lint and formatting checks pass.
4. No accessibility violations detectable by automated tooling.
5. No `any` types, `dangerouslySetInnerHTML` with unsanitized input, missing `useEffect` dependencies, or inline object literals in hot render paths.
6. No dead components or unused exports.
