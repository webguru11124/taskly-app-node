import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MouseEvent } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { Button } from '../../../design-system'
import { todoFixture } from '../../../test/todoFixture'
import { useDeleteTodoMutation } from '../hooks/useDeleteTodoMutation'
import { DeleteTodoDialog } from './DeleteTodoDialog'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useDeleteTodoMutation', () => ({
  useDeleteTodoMutation: vi.fn(),
}))
beforeEach(() => vi.clearAllMocks())

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

function renderDialog(busy = false) {
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  render(
    <DeleteTodoDialog
      todo={todoFixture}
      busy={busy}
      onClose={onClose}
      onDeleted={onDeleted}
    />,
  )
  return { onClose, onDeleted }
}

it('shows a deletion error and allows cancelling without deleting', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn()
  vi.mocked(useDeleteTodoMutation).mockReturnValue({
    isPending: false,
    error: new Error('Could not delete.'),
    mutateAsync,
  } as unknown as ReturnType<typeof useDeleteTodoMutation>)
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  render(
    <DeleteTodoDialog
      todo={todoFixture}
      busy={false}
      onClose={onClose}
      onDeleted={onDeleted}
    />,
  )
  expect(screen.getByRole('dialog', { name: 'Delete task?' })).toBeVisible()
  expect(
    screen.getByText(
      `The task “${todoFixture.title}” will be permanently deleted.`,
    ),
  ).toBeVisible()
  expect(screen.getByTestId('alert')).toHaveTextContent('Could not delete.')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(mutateAsync).not.toHaveBeenCalled()
  expect(onDeleted).not.toHaveBeenCalled()
})

it('deletes the task and reports success', async () => {
  const user = userEvent.setup()
  const mutateAsync = mockMutation()
  const { onClose, onDeleted } = renderDialog()
  expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Delete task' }))
  expect(mutateAsync).toHaveBeenCalledWith(todoFixture.id)
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
  expect(onClose).not.toHaveBeenCalled()
})

it('stays open without reporting success when deletion fails', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn().mockRejectedValue(new Error('Could not delete.'))
  mockMutation({ mutateAsync })
  const { onClose, onDeleted } = renderDialog()
  await user.click(screen.getByRole('button', { name: 'Delete task' }))
  expect(mutateAsync).toHaveBeenCalledWith(todoFixture.id)
  expect(onDeleted).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'Delete task?' })).toBeVisible()
})

it.each([
  { reason: 'the page is busy', busy: true, isPending: false },
  { reason: 'the deletion is pending', busy: false, isPending: true },
])('locks the dialog while $reason', ({ busy, isPending }) => {
  const mutateAsync = mockMutation({ isPending })
  renderDialog(busy)
  expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
  // Even if the disabled button is activated, no second deletion starts.
  const { calls } = vi.mocked(Button).mock
  const deleteProps = calls.find(([props]) => props.variant === 'danger')?.[0]
  expect(deleteProps?.children).toBe('Deleting…')
  deleteProps?.onClick?.({} as MouseEvent<HTMLButtonElement>)
  expect(mutateAsync).not.toHaveBeenCalled()
})
