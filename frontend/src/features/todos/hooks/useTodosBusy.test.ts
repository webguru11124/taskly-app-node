import { useMutation, type MutationKey } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { createQueryWrapper, deferred } from '../../../test/query'
import { todoKeys } from '../api/queryKeys'
import { useTodosBusy } from './useTodosBusy'

function setup(mutationKey: MutationKey) {
  const { wrapper } = createQueryWrapper()
  const request = deferred<void>()
  const { result } = renderHook(
    () => ({
      busy: useTodosBusy(),
      mutation: useMutation({ mutationKey, mutationFn: () => request.promise }),
    }),
    { wrapper },
  )
  return { request, result }
}

it.each(['create', 'update', 'delete'] as const)(
  'is busy only while a task %s mutation is running',
  async (name) => {
    const { request, result } = setup(todoKeys[name])
    expect(result.current.busy).toBe(false)
    act(() => result.current.mutation.mutate())
    await waitFor(() => expect(result.current.busy).toBe(true))
    await act(async () => request.resolve())
    await waitFor(() => expect(result.current.busy).toBe(false))
  },
)

it('stays idle while a mutation outside the tasks feature runs', async () => {
  const { request, result } = setup(['settings', 'update'])
  act(() => result.current.mutation.mutate())
  await waitFor(() => expect(result.current.mutation.isPending).toBe(true))
  expect(result.current.busy).toBe(false)
  await act(async () => request.resolve())
})
