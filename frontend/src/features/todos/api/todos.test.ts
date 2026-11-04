import { beforeEach, expect, it, vi } from 'vitest'
import { request } from '../../../lib/http'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { todosApi } from './todos'

vi.mock('../../../lib/http', () => ({ request: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('passes the abort signal when fetching tasks', async () => {
  const signal = new AbortController().signal
  vi.mocked(request).mockResolvedValue([todoFixture])
  await expect(todosApi.list(signal)).resolves.toEqual([todoFixture])
  expect(request).toHaveBeenCalledWith('/todos', { signal })
})

it('sends only writable task fields on creation', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await expect(todosApi.create(todoFixture)).resolves.toEqual(todoFixture)
  expect(request).toHaveBeenCalledWith('/todos', {
    method: 'POST',
    body: JSON.stringify({
      title: todoFixture.title,
      description: '',
      priority: 'medium',
      due_date: null,
      completed: false,
    }),
  })
})

it('patches a task with only the provided writable fields', async () => {
  const saved = { ...todoFixture, completed: true }
  vi.mocked(request).mockResolvedValue(saved)
  await expect(todosApi.update(7, { completed: true })).resolves.toEqual(saved)
  expect(request).toHaveBeenCalledWith('/todos/7', {
    method: 'PATCH',
    body: JSON.stringify({ completed: true }),
  })
})

it('strips read-only fields when patching with a whole task', async () => {
  const edited: Todo = { ...todoFixture, title: 'Ship it', priority: 'high' }
  vi.mocked(request).mockResolvedValue(edited)
  await todosApi.update(edited.id, edited)
  expect(request).toHaveBeenCalledWith('/todos/7', {
    method: 'PATCH',
    body: JSON.stringify({
      title: 'Ship it',
      description: '',
      priority: 'high',
      due_date: null,
      completed: false,
    }),
  })
})

it('duplicates a task with a POST to its duplicate endpoint', async () => {
  const copy = { ...todoFixture, id: 9 }
  vi.mocked(request).mockResolvedValue(copy)
  await expect(todosApi.duplicate(7)).resolves.toEqual(copy)
  expect(request).toHaveBeenCalledWith('/todos/7/duplicate', { method: 'POST' })
})

it('deletes a task by id', async () => {
  vi.mocked(request).mockResolvedValue(undefined)
  await expect(todosApi.remove(7)).resolves.toBeUndefined()
  expect(request).toHaveBeenCalledWith('/todos/7', { method: 'DELETE' })
})
