import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useNotice } from './useNotice'

afterEach(() => vi.useRealTimers())

it('starts without a notice and exposes a notification callback', () => {
  const { result } = renderHook(() => useNotice())
  expect(result.current.message).toBe('')
  expect(result.current.notify).toEqual(expect.any(Function))
})

it('shows a notice and clears it after 4 seconds', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNotice())
  const { notify } = result.current
  act(() => notify('Task deleted.'))
  expect(result.current.message).toBe('Task deleted.')
  expect(result.current.notify).toBe(notify)
  act(() => vi.advanceTimersByTime(3999))
  expect(result.current.message).toBe('Task deleted.')
  act(() => vi.advanceTimersByTime(1))
  expect(result.current.message).toBe('')
})

it('restarts the timer for a new notice, even with the same text', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('Changes saved.'))
  act(() => vi.advanceTimersByTime(3000))
  act(() => result.current.notify('Changes saved.'))
  act(() => vi.advanceTimersByTime(3000))
  expect(result.current.message).toBe('Changes saved.')
  act(() => vi.advanceTimersByTime(1000))
  expect(result.current.message).toBe('')
})

it('cancels the pending timer on unmount', () => {
  vi.useFakeTimers()
  const { result, unmount } = renderHook(() => useNotice())
  act(() => result.current.notify('New task added.'))
  expect(vi.getTimerCount()).toBe(1)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
