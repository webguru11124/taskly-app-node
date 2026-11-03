# Frontend test patterns

Every snippet follows the conventions in `../SKILL.md`. Paths are relative to
the test file. Adapt names. Don't copy blindly.

## Feature component with design-system mocks

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { Badge } from '../../../design-system'
import { todoFixture } from '../../../test/todoFixture'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
beforeEach(() => vi.clearAllMocks())

it('marks a completed task and forwards toggling', async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  render(
    <TodoItem
      todo={{ ...todoFixture, completed: true }}
      busy={false}
      onToggle={onToggle}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getByText('Completed')).toBeVisible()
  expect(vi.mocked(Badge).mock.calls[0][0]).toEqual(
    expect.objectContaining({ variant: 'success' }),
  )
  await user.click(
    screen.getByRole('checkbox', { name: `Mark as active: ${todoFixture.title}` }),
  )
  expect(onToggle).toHaveBeenCalledTimes(1)
})
```

## Component that uses a mutation hook

```tsx
vi.mock('../hooks/useDeleteTodoMutation', () => ({
  useDeleteTodoMutation: vi.fn(),
}))

function mockMutation(overrides: Record<string, unknown> = {}) {
  const mutateAsync = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useDeleteTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync,
    ...overrides,
  } as unknown as ReturnType<typeof useDeleteTodoMutation>)
  return mutateAsync
}
```

A rejected `mutateAsync` (`vi.fn().mockRejectedValue(new Error('x'))`) checks
that the component stays open and doesn't report success.

## Query or mutation hook with a real QueryClient

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

it('replaces the saved task in the cached list', async () => {
  const { client, wrapper } = setup()
  const other = { ...todoFixture, id: 8 }
  client.setQueryData(todoKeys.list, [todoFixture, other])
  const saved = { ...todoFixture, completed: true }
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  await result.current.mutateAsync({ id: 7, input: { completed: true } })
  expect(todosApi.update).toHaveBeenCalledWith(7, { completed: true })
  await waitFor(() =>
    expect(client.getQueryData(todoKeys.list)).toEqual([saved, other]),
  )
})
```

`useTodosBusy` reads `useIsMutating({ mutationKey: todoKeys.all })`. Start a
mutation whose promise you control (`new Promise(...)` with an exposed
`resolve`) and assert `true`, then resolve it and assert `false`.

## `lib/http.ts` with a stubbed fetch

```ts
import { afterEach, expect, it, vi } from 'vitest'
import { request } from './http'

afterEach(() => vi.unstubAllGlobals())

function respond(status: number, body?: unknown) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

it('prefixes the API path and sends JSON headers', async () => {
  const fetch = respond(200, { ok: true })
  await expect(request('/todos', { method: 'POST' })).resolves.toEqual({ ok: true })
  expect(fetch).toHaveBeenCalledWith('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
})
```

Status `204` must resolve to `undefined`. Only `null` bodies are allowed for
204 in the `Response` constructor. A rejected `fetch` maps to the "Cannot
connect" message unless the signal was aborted.

## Pure utilities and time

```ts
afterEach(() => vi.useRealTimers())

it('flags only active tasks due before today (local time)', () => {
  vi.useFakeTimers({ now: new Date(2026, 9, 10, 12) })
  expect(isOverdue({ ...todoFixture, due_date: '2026-10-09' })).toBe(true)
  expect(isOverdue({ ...todoFixture, due_date: '2026-10-10' })).toBe(false)
  expect(isOverdue({ ...todoFixture, due_date: '2026-10-09', completed: true })).toBe(false)
})
```

## Providers

`AppProviders` accepts an optional `client`. Pass a fresh `QueryClient` and
check that children can read it with `useQueryClient()` and the theme with
`useTheme()` from `styled-components`. `GlobalStyles` renders nothing
checkable in jsdom, so don't assert on it.
