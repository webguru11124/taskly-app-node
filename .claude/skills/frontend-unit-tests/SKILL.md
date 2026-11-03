---
name: frontend-unit-tests
description: Conventions and proven patterns for writing Vitest and React Testing Library unit tests for the Taskly frontend (React 19, TanStack Query 5, styled-components design system). Use when creating or updating *.test.ts(x) files under frontend/src.
---

# Frontend unit tests (`frontend/`)

Stack: React 19, TypeScript (strict), TanStack Query 5, styled-components,
Vitest 4 (jsdom), Testing Library (`react`, `user-event`, `jest-dom`).

## Where tests live

- **Colocated** next to the source file with the same name:
  `src/features/todos/components/TodoItem.tsx` → `TodoItem.test.tsx`, and
  `src/lib/http.ts` → `http.test.ts`. Use `.test.tsx` when the test renders
  JSX and `.test.ts` otherwise.
- Shared fixtures are in `src/test/` (`todoFixture.ts`). Add new shared helpers
  there. `src/test/setup.ts` already registers `jest-dom` matchers and runs
  `cleanup` after each test.
- Coverage excludes `src/design-system/**`, `types.ts`, `index.ts`,
  `main.tsx`, `queryKeys.ts`, and `queryClient.ts`. Don't spend effort there
  unless asked.

## File conventions

- Prettier style: **no semicolons, single quotes, trailing commas**, 2-space
  indent, 80 columns. Match the neighbouring tests.
- Import test APIs explicitly:
  `import { beforeEach, describe, expect, it, vi } from 'vitest'`.
- Query by **role, label, or text**, the way a user would:
  `getByRole('button', { name: 'Save task' })`, `getByLabelText('Priority')`.
  Use `getByTestId` only for the design-system mock's `alert`.
- Interactions use `const user = userEvent.setup()` and `await user.click(...)`.
  Wrap async expectations in `await waitFor(...)` or use `findBy*`.
- Type partial hook results with
  `as unknown as ReturnType<typeof useSomething>`, as the existing tests do.

## Isolation strategy (follow it)

| Unit under test | Mock | Keep real |
| --- | --- | --- |
| Feature component (`TodoItem`, `TodoForm`, ...) | Design system: `vi.mock('<rel>/design-system', () => import('<rel>/design-system/mocks'))`. Child feature components when they have their own tests. Data hooks (`useXMutation`) with `vi.fn()` return values. | The component's own logic and callbacks |
| Page (`TodosPage`) | All hooks and child components (see `TodosPage.test.tsx`) | Page orchestration: which callbacks run, notices, retry |
| Query or mutation hook (`useTodosQuery`, `use*Mutation`) | `todosApi` via `vi.mock('../api/todos', ...)` | A real `QueryClient` per test, to assert cache effects |
| API module (`api/todos.ts`) | `request` from `lib/http` | Payload shaping |
| `lib/http.ts` | Global `fetch` via `vi.stubGlobal` | Error mapping |
| Utils (`utils/todos.ts`) | Nothing, except time (`vi.setSystemTime`) | Everything |

The design-system mocks (`src/design-system/mocks.tsx`) render plain HTML
elements and are `vi.fn()` components, so you can assert props with
`vi.mocked(Alert).mock.calls[0][0]`. Call `vi.clearAllMocks()` in `beforeEach`
when you assert mock calls.

Working snippets for each row are in
[reference/patterns.md](reference/patterns.md). Read the section you need.

## Time, dates, and locale

- `isOverdue` compares against the **local** date. Pin the clock with
  `vi.useFakeTimers({ now: new Date(2026, 9, 10, 12) })` (local time) and
  restore it with `vi.useRealTimers()`.
- `formatDate('2026-10-15')` uses `Intl` `en-GB`, so expect `'15 Oct 2026'`.
- `useNotice` clears a notice after 4000 ms. Use fake timers and
  `act(() => vi.advanceTimersByTime(4000))`.
- With fake timers, create `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`,
  or switch timers on only after the interactions.

## Don'ts

- Don't render the real design system in feature tests. It needs a
  `ThemeProvider` and makes assertions brittle.
- Don't use snapshots, `container.querySelector` for behaviour, or
  implementation details such as state variable names.
- Don't share a `QueryClient` between tests. Create it in each test with
  `retry: false`.
- Don't leave globals or timers modified: `vi.unstubAllGlobals()` and
  `vi.useRealTimers()` in `afterEach`.

## Running

Use the `run-unit-tests` skill:
`node .claude/skills/run-unit-tests/scripts/run-tests.mjs frontend test src/lib/http.test.ts`
