import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { useTodoFilters } from './useTodoFilters'

const docs: Todo = {
  ...todoFixture,
  id: 1,
  title: 'Write docs',
  priority: 'high',
  created_at: '2026-10-01T09:00:00Z',
}
const login: Todo = {
  ...todoFixture,
  id: 2,
  title: 'Fix login',
  priority: 'low',
  completed: true,
  created_at: '2026-10-03T09:00:00Z',
}
const sprint: Todo = {
  ...todoFixture,
  id: 3,
  title: 'Plan sprint',
  created_at: '2026-10-02T09:00:00Z',
}
const todos = [docs, login, sprint]

it('shows every task, newest first, by default', () => {
  const { result } = renderHook(() => useTodoFilters(todos))
  expect(result.current).toEqual(
    expect.objectContaining({ filter: 'all', search: '', sort: 'newest' }),
  )
  expect(result.current.visible).toEqual([login, sprint, docs])
})

it('applies status, sort and search changes to the visible tasks', () => {
  const { result } = renderHook(() => useTodoFilters(todos))
  act(() => result.current.setFilter('active'))
  expect(result.current.filter).toBe('active')
  expect(result.current.visible).toEqual([sprint, docs])
  act(() => result.current.setSort('priority'))
  expect(result.current.sort).toBe('priority')
  expect(result.current.visible).toEqual([docs, sprint])
  act(() => result.current.setFilter('all'))
  expect(result.current.visible).toEqual([docs, sprint, login])
  act(() => result.current.setSearch('LOGIN'))
  expect(result.current.search).toBe('LOGIN')
  expect(result.current.visible).toEqual([login])
})

it('keeps the chosen filters when the task list changes', () => {
  const { result, rerender } = renderHook(
    ({ items }) => useTodoFilters(items),
    { initialProps: { items: [docs] } },
  )
  act(() => result.current.setFilter('completed'))
  expect(result.current.visible).toEqual([])
  rerender({ items: todos })
  expect(result.current.filter).toBe('completed')
  expect(result.current.visible).toEqual([login])
})
