import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useCreateTodoMutation } from '../hooks/useCreateTodoMutation'
import { useUpdateTodoMutation } from '../hooks/useUpdateTodoMutation'
import type { TodoInput } from '../types'
import { TodoEditor } from './TodoEditor'
import { TodoForm } from './TodoForm'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useCreateTodoMutation', () => ({
  useCreateTodoMutation: vi.fn(),
}))
vi.mock('../hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./TodoForm', () => ({
  TodoForm: vi.fn(
    ({
      onSubmit,
      onCancel,
    }: {
      onSubmit: (input: TodoInput) => Promise<void>
      onCancel: () => void
    }) => (
      <>
        <button onClick={() => void onSubmit(todoFixture)}>Submit form</button>
        <button onClick={onCancel}>Cancel form</button>
      </>
    ),
  ),
}))
beforeEach(() => vi.clearAllMocks())

function mockMutations({
  create = {},
  update = {},
}: {
  create?: Record<string, unknown>
  update?: Record<string, unknown>
} = {}) {
  const createAsync = vi.fn().mockResolvedValue(todoFixture)
  const updateAsync = vi.fn().mockResolvedValue(todoFixture)
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: createAsync,
    ...create,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: updateAsync,
    ...update,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  return { createAsync, updateAsync }
}

function formProps() {
  return vi.mocked(TodoForm).mock.lastCall?.[0]
}

it('creates a new task and reports a successful save', async () => {
  const user = userEvent.setup()
  const create = vi.fn().mockResolvedValue(todoFixture)
  const update = vi.fn()
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: create,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: update,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('New task added.'))
  expect(create).toHaveBeenCalledWith(todoFixture)
  expect(update).not.toHaveBeenCalled()
})

it('starts an empty form for a new task', () => {
  mockMutations()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={vi.fn()} />,
  )
  expect(formProps()).toEqual(
    expect.objectContaining({ initial: undefined, busy: false, error: null }),
  )
})

it('edits an existing task and reports the saved changes', async () => {
  const user = userEvent.setup()
  const { createAsync, updateAsync } = mockMutations()
  const onSaved = vi.fn()
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  expect(formProps()).toEqual(
    expect.objectContaining({ initial: todoFixture, busy: false }),
  )
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Changes saved.'))
  expect(updateAsync).toHaveBeenCalledWith({ id: 7, input: todoFixture })
  expect(createAsync).not.toHaveBeenCalled()
})

it('closes from the drawer and from the form', async () => {
  const user = userEvent.setup()
  mockMutations()
  const onClose = vi.fn()
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={onClose}
      onSaved={vi.fn()}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await user.click(screen.getByRole('button', { name: 'Cancel form' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})

it.each([
  { mode: 'new', todo: 'new' as const, failing: 'create' },
  { mode: 'edit', todo: todoFixture, failing: 'update' },
])(
  'shows the $mode error and stays open when saving fails',
  async ({ todo, failing }) => {
    const user = userEvent.setup()
    const failure = {
      error: new Error(`Could not ${failing}.`),
      mutateAsync: vi.fn().mockRejectedValue(new Error('Rejected')),
    }
    const other = { error: new Error('Unrelated failure.') }
    mockMutations(
      failing === 'create'
        ? { create: failure, update: other }
        : { create: other, update: failure },
    )
    const onSaved = vi.fn()
    render(
      <TodoEditor
        todo={todo}
        busy={false}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    )
    expect(formProps()?.error).toBe(`Could not ${failing}.`)
    await user.click(screen.getByRole('button', { name: 'Submit form' }))
    expect(failure.mutateAsync).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
  },
)

it.each([
  { reason: 'the page is busy', todo: 'new' as const, busy: true },
  { reason: 'a creation is pending', todo: 'new' as const, busy: false },
  { reason: 'an update is pending', todo: todoFixture, busy: false },
])('ignores submissions while $reason', async ({ todo, busy }) => {
  const user = userEvent.setup()
  const { createAsync, updateAsync } = mockMutations({
    create: { isPending: todo === 'new' && !busy },
    update: { isPending: todo !== 'new' },
  })
  const onSaved = vi.fn()
  render(
    <TodoEditor todo={todo} busy={busy} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(formProps()?.busy).toBe(true)
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  expect(createAsync).not.toHaveBeenCalled()
  expect(updateAsync).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})

it('ignores a pending mutation of the other mode', () => {
  mockMutations({ update: { isPending: true } })
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={vi.fn()} />,
  )
  expect(formProps()?.busy).toBe(false)
  expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
})
