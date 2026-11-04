import { useMutation, useQueryClient } from '@tanstack/react-query'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'

export function useDuplicateTodoMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: todoKeys.duplicate,
    mutationFn: (id: number) => todosApi.duplicate(id),
    onSuccess: async (saved) => {
      // Stop an older refetch from overwriting the confirmed server response.
      await queryClient.cancelQueries({ queryKey: todoKeys.list })
      queryClient.setQueryData<Todo[]>(todoKeys.list, (current = []) => [
        saved,
        ...current.filter((todo) => todo.id !== saved.id),
      ])
    },
  })
}
