import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MouseEvent } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { Button } from '../../../design-system'
import { useClearCompletedMutation } from '../hooks/useClearCompletedMutation'
import { ClearCompletedButton } from './ClearCompletedButton'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useClearCompletedMutation', () => ({
  useClearCompletedMutation: vi.fn(),
}))
beforeEach(() => vi.clearAllMocks())

function mockMutation(overrides: Record<string, unknown> = {}) {
  const mutateAsync = vi.fn().mockResolvedValue({ deleted: 2 })
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync,
    ...overrides,
  } as unknown as ReturnType<typeof useClearCompletedMutation>)
  return mutateAsync
}

function renderButton(props: { count?: number; disabled?: boolean } = {}) {
  const onCleared = vi.fn()
  const view = render(
    <ClearCompletedButton
      count={props.count ?? 2}
      disabled={props.disabled ?? false}
      onCleared={onCleared}
    />,
  )
  return { ...view, onCleared }
}

it('renders nothing while there are no completed tasks', () => {
  mockMutation()
  const { container } = renderButton({ count: 0 })
  expect(container).toBeEmptyDOMElement()
})

it('clears completed tasks and reports how many the server deleted', async () => {
  const user = userEvent.setup()
  const mutateAsync = mockMutation()
  const { onCleared } = renderButton({ count: 2 })
  await user.click(screen.getByRole('button', { name: 'Clear completed (2)' }))
  expect(mutateAsync).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(onCleared).toHaveBeenCalledWith(2))
  expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
})

it('keeps the button available and shows the error when clearing fails', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn().mockRejectedValue(new Error('Could not clear.'))
  mockMutation({ mutateAsync })
  const { onCleared, rerender } = renderButton()
  await user.click(screen.getByRole('button', { name: 'Clear completed (2)' }))
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
  expect(onCleared).not.toHaveBeenCalled()
  mockMutation({ error: new Error('Could not clear.') })
  rerender(
    <ClearCompletedButton count={2} disabled={false} onCleared={onCleared} />,
  )
  expect(screen.getByTestId('alert')).toHaveTextContent('Could not clear.')
  expect(
    screen.getByRole('button', { name: 'Clear completed (2)' }),
  ).toBeEnabled()
})

it.each([
  ['the page is busy', { disabled: true }, {}, 'Clear completed (2)'],
  ['clearing is in progress', {}, { isPending: true }, 'Clearing…'],
])(
  'is disabled and ignores activation while %s',
  (_, props, mutation, label) => {
    const mutateAsync = mockMutation(mutation)
    renderButton(props)
    expect(screen.getByRole('button', { name: label })).toBeDisabled()
    // Even if the disabled button is activated, no second request starts.
    vi.mocked(Button).mock.calls[0][0].onClick?.(
      {} as MouseEvent<HTMLButtonElement>,
    )
    expect(mutateAsync).not.toHaveBeenCalled()
  },
)
