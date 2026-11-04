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

function setup(cached?: Todo[]) {
  const { client, wrapper } = createQueryWrapper()
  if (cached) client.setQueryData<Todo[]>(todoKeys.list, cached)
  const { result } = renderHook(() => useDuplicateTodoMutation(), { wrapper })
  return { client, result }
}

it('duplicates the task and puts the copy first in the cached list', async () => {
  vi.mocked(todosApi.duplicate).mockResolvedValue(copy)
  const { client, result } = setup([todoFixture])
  await act(() => result.current.mutateAsync(7))
  expect(todosApi.duplicate).toHaveBeenCalledWith(7)
  expect(client.getQueryData(todoKeys.list)).toEqual([copy, todoFixture])
})

it('does not keep a stale entry with the same id as the copy', async () => {
  vi.mocked(todosApi.duplicate).mockResolvedValue(copy)
  const { client, result } = setup([todoFixture, { ...copy, title: 'stale' }])
  await act(() => result.current.mutateAsync(7))
  expect(client.getQueryData(todoKeys.list)).toEqual([copy, todoFixture])
})

it('creates the list when no tasks were loaded yet', async () => {
  vi.mocked(todosApi.duplicate).mockResolvedValue(copy)
  const { client, result } = setup()
  await act(() => result.current.mutateAsync(7))
  expect(client.getQueryData(todoKeys.list)).toEqual([copy])
})

it('exposes a failed duplication and leaves the cache untouched', async () => {
  vi.mocked(todosApi.duplicate).mockRejectedValue(new Error('Could not copy.'))
  const { client, result } = setup([todoFixture])
  await expect(result.current.mutateAsync(7)).rejects.toThrow('Could not copy.')
  await waitFor(() =>
    expect(result.current.error?.message).toBe('Could not copy.'),
  )
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
