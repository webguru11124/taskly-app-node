import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoForm } from './TodoForm'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

describe('TodoForm', () => {
  it('rejects a whitespace-only title without submitting', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '   ')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(screen.getByText('Enter a task title.')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed values and the selected priority', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '  Prepare a demo  ')
    await user.selectOptions(screen.getByLabelText('Priority'), 'high')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Prepare a demo',
      description: '',
      priority: 'high',
      due_date: null,
      completed: false,
    })
  })

  it('submits a trimmed description and the chosen due date', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), 'Book a room')
    await user.type(
      screen.getByLabelText('Description (optional)'),
      '  For the retro  ',
    )
    await user.type(screen.getByLabelText('Due date (optional)'), '2026-10-15')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Book a room',
      description: 'For the retro',
      priority: 'medium',
      due_date: '2026-10-15',
      completed: false,
    })
  })

  it('starts from an existing task and submits a cleared due date as null', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const initial = {
      ...todoFixture,
      description: 'Slides and notes',
      priority: 'low' as const,
      due_date: '2026-10-15',
    }
    render(
      <TodoForm
        initial={initial}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    expect(screen.getByLabelText(/Task title/)).toHaveValue(todoFixture.title)
    expect(screen.getByLabelText('Description (optional)')).toHaveValue(
      'Slides and notes',
    )
    expect(screen.getByLabelText('Priority')).toHaveValue('low')
    const dueDate = screen.getByLabelText('Due date (optional)')
    expect(dueDate).toHaveValue('2026-10-15')
    await user.clear(dueDate)
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: todoFixture.title,
        description: 'Slides and notes',
        priority: 'low',
        due_date: null,
      }),
    )
  })

  it('shows length errors for the title and description', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.click(screen.getByLabelText(/Task title/))
    await user.paste('t'.repeat(121))
    await user.click(screen.getByLabelText('Description (optional)'))
    await user.paste('d'.repeat(2001))
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(
      screen.getByText('The title must be at most 120 characters.'),
    ).toBeVisible()
    expect(
      screen.getByText('The description must be at most 2000 characters.'),
    ).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancels without submitting and shows no server error by default', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={onCancel}
        busy={false}
        error={null}
      />,
    )
    expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows the server error and locks the form while saving', () => {
    render(
      <TodoForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        busy
        error="Could not save the task."
      />,
    )
    expect(screen.getByTestId('alert')).toHaveTextContent(
      'Could not save the task.',
    )
    for (const field of [
      /Task title/,
      'Description (optional)',
      'Priority',
      'Due date (optional)',
    ]) {
      expect(screen.getByLabelText(field)).toBeDisabled()
    }
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Save task' }),
    ).not.toBeInTheDocument()
  })
})
