import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from './http'

const genericError = 'The operation failed. Please try again.'
const connectionError = 'Cannot connect to the server. Please try again.'

afterEach(() => vi.unstubAllGlobals())

function respond(status: number, body: unknown = null) {
  const text =
    body === null || typeof body === 'string' ? body : JSON.stringify(body)
  const fetch = vi.fn(async () => new Response(text, { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('request', () => {
  it('prefixes the API path, sends JSON headers and returns the body', async () => {
    const fetch = respond(200, { id: 7 })
    await expect(
      request('/todos', { method: 'POST', body: '{}' }),
    ).resolves.toEqual({ id: 7 })
    expect(fetch).toHaveBeenCalledWith('/api/todos', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('sends JSON headers without options and keeps custom headers', async () => {
    const fetch = respond(200, [])
    await expect(request('/todos')).resolves.toEqual([])
    expect(fetch).toHaveBeenLastCalledWith('/api/todos', {
      headers: { 'Content-Type': 'application/json' },
    })
    await request('/todos', { headers: { 'X-Trace': 'abc' } })
    expect(fetch).toHaveBeenLastCalledWith('/api/todos', {
      headers: { 'Content-Type': 'application/json', 'X-Trace': 'abc' },
    })
  })

  it('resolves to undefined for 204 No Content', async () => {
    respond(204)
    await expect(
      request('/todos/7', { method: 'DELETE' }),
    ).resolves.toBeUndefined()
  })

  it('maps 422 responses to a task validation message', async () => {
    respond(422, { detail: 'title: too long' })
    await expect(request('/todos', { method: 'POST' })).rejects.toThrow(
      'Check the task details: title up to 120 characters, description up to 2000 characters, and a valid due date.',
    )
  })

  it.each([
    ['a string detail', 404, { detail: 'Task not found.' }, 'Task not found.'],
    ['a non-string detail', 400, { detail: [{ msg: 'x' }] }, genericError],
    ['a non-JSON body', 500, 'Internal Server Error', genericError],
    ['an empty body', 503, null, genericError],
  ])(
    'rejects an error response with %s using the right message',
    async (_, status, body, message) => {
      respond(status, body)
      await expect(request('/todos/7')).rejects.toThrow(message)
    },
  )

  it('reports a connection problem when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed')))
    await expect(request('/todos')).rejects.toThrow(connectionError)
    const { signal } = new AbortController()
    await expect(request('/todos', { signal })).rejects.toThrow(connectionError)
  })

  it('rethrows the original error when the request was aborted', async () => {
    const controller = new AbortController()
    const { signal } = controller
    const abortError = new DOMException('Aborted', 'AbortError')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        controller.abort()
        return Promise.reject(abortError)
      }),
    )
    await expect(request('/todos', { signal })).rejects.toBe(abortError)
  })
})
