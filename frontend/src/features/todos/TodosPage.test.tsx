import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, expect, it, vi, type Mock } from 'vitest'
import { useNotice } from '../../hooks/useNotice'
import { todoFixture } from '../../test/todoFixture'
import { DeleteTodoDialog } from './components/DeleteTodoDialog'
import { TodoEditor } from './components/TodoEditor'
import { TodoList } from './components/TodoList'
import { useDuplicateTodoMutation } from './hooks/useDuplicateTodoMutation'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import { TodosPage } from './TodosPage'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useDuplicateTodoMutation', () => ({
  useDuplicateTodoMutation: vi.fn(),
}))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./components/TodosHeader', () => ({
  TodosHeader: ({
    disabled,
    onCreate,
  }: {
    disabled: boolean
    onCreate: () => void
  }) => (
    <>
      <h1>Tasks</h1>
      <button disabled={disabled} onClick={onCreate}>
        New task
      </button>
    </>
  ),
}))
vi.mock('./components/TodoFilters', () => ({ TodoFilters: () => null }))
vi.mock('./components/TodoList', () => ({
  TodoList: vi.fn(
    ({
      todos,
      onCreate,
      onToggle,
      onEdit,
      onDuplicate,
      onDelete,
    }: ComponentProps<typeof TodoList>) => (
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <button onClick={() => onToggle(todo)}>Toggle {todo.title}</button>
            <button onClick={() => onEdit(todo)}>Edit {todo.title}</button>
            <button onClick={() => onDuplicate(todo)}>
              Duplicate {todo.title}
            </button>
            <button onClick={() => onDelete(todo)}>Delete {todo.title}</button>
          </li>
        ))}
        <li>
          <button onClick={onCreate}>Add first task</button>
        </li>
      </ul>
    ),
  ),
}))
vi.mock('./components/TodoEditor', () => ({
  TodoEditor: vi.fn(
    ({ onClose, onSaved }: ComponentProps<typeof TodoEditor>) => (
      <div role="dialog" aria-label="Task editor">
        <button onClick={onClose}>Close editor</button>
        <button onClick={() => onSaved('Changes saved.')}>Save editor</button>
      </div>
    ),
  ),
}))
vi.mock('./components/DeleteTodoDialog', () => ({
  DeleteTodoDialog: vi.fn(
    ({ onClose, onDeleted }: ComponentProps<typeof DeleteTodoDialog>) => (
      <div role="dialog" aria-label="Delete confirmation">
        <button onClick={onClose}>Keep task</button>
        <button onClick={onDeleted}>Confirm deletion</button>
      </div>
    ),
  ),
}))
vi.mock('../../components/SuccessNotice', () => ({
  SuccessNotice: ({ message }: { message: string }) => (
    <output>{message}</output>
  ),
}))
beforeEach(() => vi.clearAllMocks())

function setup({
  query = {},
  mutationError = null,
  mutateAsync = vi.fn(),
  duplicateError = null,
  duplicateAsync = vi.fn(),
  busy = false,
  message = '',
}: {
  query?: Record<string, unknown>
  mutationError?: Error | null
  mutateAsync?: Mock
  duplicateError?: Error | null
  duplicateAsync?: Mock
  busy?: boolean
  message?: string
} = {}) {
  const notify = vi.fn()
  const refetch = vi.fn().mockResolvedValue(undefined)
  const duplicateReset = vi.fn()
  const toggleReset = vi.fn()
  vi.mocked(useDuplicateTodoMutation).mockReturnValue({
    error: duplicateError,
    reset: duplicateReset,
    mutateAsync: duplicateAsync,
  } as unknown as ReturnType<typeof useDuplicateTodoMutation>)
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [todoFixture],
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch,
    ...query,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: mutationError,
    reset: toggleReset,
    mutateAsync,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(busy)
  vi.mocked(useNotice).mockReturnValue({ message, notify })
  vi.mocked(useTodoFilters).mockImplementation((todos) => ({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: todos,
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  }))
  render(<TodosPage />)
  return { notify, refetch, duplicateReset, toggleReset }
}

const button = (name: string) => screen.getByRole('button', { name })

it('displays a query failure and resets mutation errors before retrying', async () => {
  const user = userEvent.setup()
  const refetch = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [],
    isPending: false,
    isFetching: false,
    isError: true,
    error: new Error('The server is unavailable.'),
    refetch,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const duplicateReset = vi.fn()
  vi.mocked(useDuplicateTodoMutation).mockReturnValue({
    error: null,
    reset: duplicateReset,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useDuplicateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify: vi.fn() })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'The server is unavailable.',
  )
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(duplicateReset).toHaveBeenCalledTimes(1)
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    refetch.mock.invocationCallOrder[0],
  )
})

it('passes the loading state on before any task has arrived', () => {
  setup({ query: { data: undefined, isPending: true }, message: 'Hello' })
  expect(useTodoFilters).toHaveBeenCalledWith([])
  expect(button('New task')).toBeDisabled()
  expect(vi.mocked(TodoList).mock.lastCall?.[0]).toEqual(
    expect.objectContaining({
      todos: [],
      hasTodos: false,
      loading: true,
      failed: false,
      busy: false,
    }),
  )
  expect(screen.getByRole('status')).toHaveTextContent('Hello')
  expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
})

it.each([
  { completed: false, notice: 'Another task complete. Well done!' },
  { completed: true, notice: 'Task marked as active.' },
])(
  'toggles a task with completed=$completed and announces "$notice"',
  async ({ completed, notice }) => {
    const user = userEvent.setup()
    const todo = { ...todoFixture, completed }
    const saved = { ...todo, completed: !completed }
    const mutateAsync = vi.fn().mockResolvedValue(saved)
    const { notify } = setup({ query: { data: [todo] }, mutateAsync })
    await user.click(button(`Toggle ${todo.title}`))
    expect(mutateAsync).toHaveBeenCalledWith({
      id: todo.id,
      input: { completed: !completed },
    })
    await waitFor(() => expect(notify).toHaveBeenCalledWith(notice))
  },
)

it('duplicates a task and announces it', async () => {
  const user = userEvent.setup()
  const duplicateAsync = vi.fn().mockResolvedValue(todoFixture)
  const { notify } = setup({ duplicateAsync })
  await user.click(button(`Duplicate ${todoFixture.title}`))
  expect(duplicateAsync).toHaveBeenCalledWith(todoFixture.id)
  await waitFor(() => expect(notify).toHaveBeenCalledWith('Task duplicated.'))
})

it('shows a duplication error without a notice and resets it on retry', async () => {
  const user = userEvent.setup()
  const duplicateAsync = vi.fn().mockRejectedValue(new Error('Rejected'))
  const { notify, duplicateReset, toggleReset, refetch } = setup({
    duplicateAsync,
    duplicateError: new Error('Could not duplicate the task.'),
    query: { error: new Error('The server is unavailable.') },
  })
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'Could not duplicate the task.',
  )
  await user.click(button(`Duplicate ${todoFixture.title}`))
  expect(duplicateAsync).toHaveBeenCalledTimes(1)
  expect(notify).not.toHaveBeenCalled()
  await user.click(button('Try again'))
  expect(duplicateReset).toHaveBeenCalledTimes(1)
  expect(toggleReset).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
})

it('shows a toggle error ahead of a query error without a notice', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn().mockRejectedValue(new Error('Rejected'))
  const { notify } = setup({
    query: { isError: true, error: new Error('The server is unavailable.') },
    mutationError: new Error('Could not update the task.'),
    mutateAsync,
  })
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'Could not update the task.',
  )
  await user.click(button(`Toggle ${todoFixture.title}`))
  expect(mutateAsync).toHaveBeenCalledTimes(1)
  expect(notify).not.toHaveBeenCalled()
})

it('ignores toggles and blocks creating or retrying while tasks are busy', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn()
  const duplicateAsync = vi.fn()
  setup({
    busy: true,
    mutateAsync,
    duplicateAsync,
    query: { isError: true, error: new Error('The server is unavailable.') },
  })
  await user.click(button(`Toggle ${todoFixture.title}`))
  expect(mutateAsync).not.toHaveBeenCalled()
  await user.click(button(`Duplicate ${todoFixture.title}`))
  expect(duplicateAsync).not.toHaveBeenCalled()
  expect(button('New task')).toBeDisabled()
  expect(button('Try again')).toBeDisabled()
  expect(vi.mocked(TodoList).mock.lastCall?.[0].busy).toBe(true)
  await user.click(button(`Edit ${todoFixture.title}`))
  expect(vi.mocked(TodoEditor).mock.lastCall?.[0].busy).toBe(true)
  await user.click(button(`Delete ${todoFixture.title}`))
  expect(vi.mocked(DeleteTodoDialog).mock.lastCall?.[0].busy).toBe(true)
})

it('disables retrying while the task list is refetching', () => {
  setup({
    query: {
      isFetching: true,
      isError: true,
      error: new Error('The server is unavailable.'),
    },
  })
  expect(button('Try again')).toBeDisabled()
})

it('opens the editor for a new task from the header or the list', async () => {
  const user = userEvent.setup()
  setup()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(button('New task'))
  expect(screen.getByRole('dialog', { name: 'Task editor' })).toBeVisible()
  expect(vi.mocked(TodoEditor).mock.lastCall?.[0]).toEqual(
    expect.objectContaining({ todo: 'new', busy: false }),
  )
  await user.click(button('Close editor'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  vi.mocked(TodoEditor).mockClear()
  await user.click(button('Add first task'))
  expect(vi.mocked(TodoEditor).mock.lastCall?.[0].todo).toBe('new')
})

it('edits a task and announces the save after closing the editor', async () => {
  const user = userEvent.setup()
  const { notify } = setup()
  await user.click(button(`Edit ${todoFixture.title}`))
  expect(vi.mocked(TodoEditor).mock.lastCall?.[0].todo).toBe(todoFixture)
  await user.click(button('Save editor'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).toHaveBeenCalledWith('Changes saved.')
})

it('confirms a deletion before announcing it', async () => {
  const user = userEvent.setup()
  const { notify } = setup()
  await user.click(button(`Delete ${todoFixture.title}`))
  expect(
    screen.getByRole('dialog', { name: 'Delete confirmation' }),
  ).toBeVisible()
  expect(vi.mocked(DeleteTodoDialog).mock.lastCall?.[0].todo).toBe(todoFixture)
  await user.click(button('Keep task'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).not.toHaveBeenCalled()
  await user.click(button(`Delete ${todoFixture.title}`))
  await user.click(button('Confirm deletion'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).toHaveBeenCalledWith('Task deleted.')
})
