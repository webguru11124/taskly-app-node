import { Trash2 } from 'lucide-react'
import { Alert, Button } from '../../../design-system'
import { useClearCompletedMutation } from '../hooks/useClearCompletedMutation'

export function ClearCompletedButton({
  count,
  disabled,
  onCleared,
}: {
  count: number
  disabled: boolean
  onCleared: (deleted: number) => void
}) {
  const clearCompleted = useClearCompletedMutation()
  const pending = disabled || clearCompleted.isPending
  if (count === 0) return null

  async function clear() {
    if (pending) return
    try {
      const { deleted } = await clearCompleted.mutateAsync()
      onCleared(deleted)
    } catch {
      // The mutation error is shown next to the button and the user can retry.
    }
  }

  return (
    <div className="row compact">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => void clear()}
      >
        <Trash2 size={16} aria-hidden="true" />
        {clearCompleted.isPending ? 'Clearing…' : `Clear completed (${count})`}
      </Button>
      {clearCompleted.error && (
        <Alert variant="warning">{clearCompleted.error.message}</Alert>
      )}
    </div>
  )
}
