import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useTheme } from 'styled-components'
import { beforeEach, expect, it, vi } from 'vitest'
import { GlobalStyles, theme } from '../design-system'
import { queryClient } from '../lib/queryClient'
import { AppProviders } from './AppProviders'

vi.mock('../design-system', () => import('../design-system/mocks'))
beforeEach(() => vi.clearAllMocks())

function useProvided() {
  return { client: useQueryClient(), theme: useTheme() }
}

it('provides the given query client, the theme and global styles', () => {
  const client = new QueryClient()
  const { result } = renderHook(useProvided, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AppProviders client={client}>{children}</AppProviders>
    ),
  })
  expect(result.current.client).toBe(client)
  expect(result.current.theme).toEqual(theme)
  expect(GlobalStyles).toHaveBeenCalled()
})

it('falls back to the application query client', () => {
  const { result } = renderHook(useProvided, { wrapper: AppProviders })
  expect(result.current.client).toBe(queryClient)
  expect(result.current.theme).toEqual(theme)
})
