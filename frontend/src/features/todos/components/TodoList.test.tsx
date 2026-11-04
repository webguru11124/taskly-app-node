import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoEmptyState } from './TodoEmptyState'
import type { TodoItem } from './TodoItem'
import { TodoList } from './TodoList'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoEmptyState', () => ({
  TodoEmptyState: vi.fn(() => <p>Empty task list</p>),
}))
vi.mock('./TodoItem', () => ({
  TodoItem: ({
    todo,
    busy,
    onToggle,
    onEdit,
    onDuplicate,
    onDelete,
  }: ComponentProps<typeof TodoItem>) => (
    <li>
      <button disabled={busy} onClick={onToggle}>
        Toggle {todo.title}
      </button>
      <button disabled={busy} onClick={onEdit}>
        Edit {todo.title}
      </button>
      <button disabled={busy} onClick={onDuplicate}>
        Duplicate {todo.title}
      </button>
      <button disabled={busy} onClick={onDelete}>
        Delete {todo.title}
      </button>
    </li>
  ),
}))
beforeEach(() => vi.clearAllMocks())

const callbacks = () => ({
  onCreate: vi.fn(),
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
})

it('shows loading feedback before showing an empty list', () => {
  const props = {
    todos: [],
    hasTodos: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
  }
  const { rerender } = render(<TodoList {...props} loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  rerender(<TodoList {...props} loading={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
})

it('explains that the list is unavailable when loading failed', () => {
  render(
    <TodoList
      todos={[]}
      hasTodos={false}
      loading={false}
      failed
      busy={false}
      {...callbacks()}
    />,
  )
  expect(
    screen.getByRole('heading', {
      name: 'The task list is temporarily unavailable',
    }),
  ).toBeVisible()
  expect(screen.getByText('Try again to load your tasks.')).toBeVisible()
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
})

it('keeps showing cached tasks after a failed refresh and forwards actions', async () => {
  const user = userEvent.setup()
  const todo = todoFixture
  const other = { ...todoFixture, id: 8, title: 'Review the plan' }
  const handlers = callbacks()
  render(
    <TodoList
      todos={[todo, other]}
      hasTodos
      loading={false}
      failed
      busy={false}
      {...handlers}
    />,
  )
  const button = (name: string) => screen.getByRole('button', { name })
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  await user.click(button(`Toggle ${other.title}`))
  expect(handlers.onToggle).toHaveBeenCalledWith(other)
  await user.click(button(`Edit ${todo.title}`))
  expect(handlers.onEdit).toHaveBeenCalledWith(todo)
  await user.click(button(`Duplicate ${other.title}`))
  expect(handlers.onDuplicate).toHaveBeenCalledWith(other)
  await user.click(button(`Delete ${other.title}`))
  expect(handlers.onDelete).toHaveBeenCalledWith(other)
  expect(handlers.onCreate).not.toHaveBeenCalled()
})

it('passes the busy state to every task', () => {
  render(
    <TodoList
      todos={[todoFixture]}
      hasTodos
      loading={false}
      failed={false}
      busy
      {...callbacks()}
    />,
  )
  for (const button of screen.getAllByRole('button')) {
    expect(button).toBeDisabled()
  }
})

it('shows the empty state for tasks hidden by the filters', () => {
  const handlers = callbacks()
  render(
    <TodoList
      todos={[]}
      hasTodos
      loading={false}
      failed={false}
      busy
      {...handlers}
    />,
  )
  expect(screen.getByText('Empty task list')).toBeVisible()
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
  expect(vi.mocked(TodoEmptyState).mock.lastCall?.[0]).toEqual({
    hasTodos: true,
    disabled: true,
    onCreate: handlers.onCreate,
  })
})
