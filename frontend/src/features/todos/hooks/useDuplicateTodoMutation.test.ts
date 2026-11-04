import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/query'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useDuplicateTodoMutation } from './useDuplicateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { duplicate: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

const copy: Todo = { ...todoFixture, id: 9, title: 'Plan (copy)' }
const other: Todo = { ...todoFixture, id: 8, title: 'Review the plan' }

function setup(cached?: Todo[]) {
  const { client, wrapper } = createQueryWrapper()
  if (cached) client.setQueryData<Todo[]>(todoKeys.list, cached)
  const { result } = renderHook(() => useDuplicateTodoMutation(), { wrapper })
  return { client, result }
}

it('duplicates the task and puts the copy first in the cached list', async () => {
  vi.mocked(todosApi.duplicate).mockResolvedValue(copy)
  const { client, result } = setup([todoFixture, other])
  await act(() => result.current.mutateAsync(7))
  expect(todosApi.duplicate).toHaveBeenCalledWith(7)
  expect(client.getQueryData(todoKeys.list)).toEqual([copy, todoFixture, other])
})

it('replaces an existing cached entry with the same id', async () => {
  vi.mocked(todosApi.duplicate).mockResolvedValue(copy)
  const { client, result } = setup([other, { ...copy, title: 'stale' }])
  await act(() => result.current.mutateAsync(7))
  expect(client.getQueryData(todoKeys.list)).toEqual([copy, other])
})

it('starts a list with the copy when no tasks were loaded yet', async () => {
  vi.mocked(todosApi.duplicate).mockResolvedValue(copy)
  const { client, result } = setup()
  await act(() => result.current.mutateAsync(7))
  expect(client.getQueryData(todoKeys.list)).toEqual([copy])
})

it('exposes a failed duplication and keeps the cache unchanged', async () => {
  vi.mocked(todosApi.duplicate).mockRejectedValue(new Error('Could not copy.'))
  const { client, result } = setup([todoFixture])
  await expect(result.current.mutateAsync(7)).rejects.toThrow('Could not copy.')
  await waitFor(() =>
    expect(result.current.error?.message).toBe('Could not copy.'),
  )
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
