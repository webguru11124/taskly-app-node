import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Badge } from '../../../design-system'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
beforeEach(() => vi.clearAllMocks())

function renderItem(todo: Todo, busy = false) {
  const callbacks = {
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
  }
  render(<TodoItem todo={todo} busy={busy} {...callbacks} />)
  return callbacks
}

function badgeVariants() {
  return vi.mocked(Badge).mock.calls.map(([props]) => props.variant)
}

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={onEdit}
      onToggle={onToggle}
      onDuplicate={vi.fn()}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  expect(screen.getByText('To do')).toBeVisible()
  expect(screen.getByText('Medium')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

it('offers to complete an active task and forwards deletion', async () => {
  const user = userEvent.setup()
  const { onToggle, onEdit, onDelete } = renderItem(todoFixture)
  expect(badgeVariants()).toEqual(['info'])
  expect(screen.getByText(`#${todoFixture.id}`)).toBeVisible()
  await user.click(
    screen.getByRole('button', { name: `Delete: ${todoFixture.title}` }),
  )
  expect(onDelete).toHaveBeenCalledTimes(1)
  await user.click(
    screen.getByRole('checkbox', { name: `Complete: ${todoFixture.title}` }),
  )
  expect(onToggle).toHaveBeenCalledTimes(1)
  expect(onEdit).not.toHaveBeenCalled()
})

it('forwards duplication requests only', async () => {
  const user = userEvent.setup()
  const { onDuplicate, onEdit, onToggle, onDelete } = renderItem(todoFixture)
  await user.click(
    screen.getByRole('button', { name: `Duplicate: ${todoFixture.title}` }),
  )
  expect(onDuplicate).toHaveBeenCalledTimes(1)
  expect(onEdit).not.toHaveBeenCalled()
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

it('marks a completed task and forwards toggling', async () => {
  const user = userEvent.setup()
  const { onToggle, onDelete } = renderItem({ ...todoFixture, completed: true })
  expect(screen.getByText('Completed')).toBeVisible()
  expect(badgeVariants()).toEqual(['success'])
  const checkbox = screen.getByRole('checkbox', {
    name: `Mark as active: ${todoFixture.title}`,
  })
  expect(checkbox).toBeChecked()
  await user.click(checkbox)
  expect(onToggle).toHaveBeenCalledTimes(1)
  expect(onDelete).not.toHaveBeenCalled()
})

it('shows the description and the priority label', () => {
  renderItem({
    ...todoFixture,
    description: 'Bring the projector',
    priority: 'high',
  })
  expect(screen.getByText('Bring the projector')).toBeVisible()
  expect(screen.getByText('High')).toBeVisible()
})

it('disables every action while tasks are busy', () => {
  renderItem(todoFixture, true)
  const { title } = todoFixture
  expect(
    screen.getByRole('checkbox', { name: `Complete: ${title}` }),
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: `Edit: ${title}` })).toBeDisabled()
  expect(
    screen.getByRole('button', { name: `Duplicate: ${title}` }),
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: `Delete: ${title}` }),
  ).toBeDisabled()
})

describe('due date', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 9, 10, 12) }))
  afterEach(() => vi.useRealTimers())

  it('shows an upcoming due date in a neutral badge', () => {
    renderItem({ ...todoFixture, due_date: '2026-10-15' })
    expect(screen.getByText('15 Oct 2026')).toBeVisible()
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
    expect(badgeVariants()).toEqual(['info', 'neutral'])
  })

  it('treats a task due today as not overdue', () => {
    renderItem({ ...todoFixture, due_date: '2026-10-10' })
    expect(screen.getByText('10 Oct 2026')).toBeVisible()
    expect(badgeVariants()).toEqual(['info', 'neutral'])
  })

  it('warns about an active task that is past its due date', () => {
    renderItem({ ...todoFixture, due_date: '2026-10-09' })
    expect(screen.getByText('9 Oct 2026 · overdue')).toBeVisible()
    expect(badgeVariants()).toEqual(['info', 'warning'])
  })

  it('does not flag a completed task as overdue', () => {
    renderItem({ ...todoFixture, completed: true, due_date: '2026-10-09' })
    expect(screen.getByText('9 Oct 2026')).toBeVisible()
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
    expect(badgeVariants()).toEqual(['success', 'neutral'])
  })
})
