import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDate, isOverdue, selectTodos, validateTodo } from './todos'
import type { Todo, TodoInput } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })

  it('keeps only completed tasks and matches the title', () => {
    const done = { ...base, id: 2, title: 'Release notes', completed: true }
    const todos = [base, done, { ...done, id: 3, title: 'Retro' }]
    expect(selectTodos(todos, 'completed', 'RELEASE', 'newest')).toEqual([done])
  })

  it('orders equal priorities by the newest id first', () => {
    const low: Todo = { ...base, id: 3, priority: 'low' }
    const newer = { ...base, id: 2 }
    expect(selectTodos([base, low, newer], 'all', '', 'priority')).toEqual([
      newer,
      base,
      low,
    ])
  })

  it('sorts by due date, putting tasks without a date last', () => {
    const later = { ...base, id: 2, due_date: '2026-10-20' }
    const sooner = { ...base, id: 3, due_date: '2026-10-05' }
    const sameDay = { ...base, id: 4, due_date: '2026-10-05' }
    const undated = { ...base, id: 5 }
    expect(
      selectTodos([base, later, undated, sooner, sameDay], 'all', '', 'due'),
    ).toEqual([sameDay, sooner, later, undated, base])
  })

  it('sorts newest first by creation time, then by id', () => {
    const older = { ...base, id: 5, created_at: '2026-09-30T08:00:00Z' }
    const newest = { ...base, id: 2, created_at: '2026-10-02T08:00:00Z' }
    const twin = { ...base, id: 3 }
    expect(
      selectTodos([older, base, newest, twin], 'all', '', 'newest'),
    ).toEqual([newest, twin, base, older])
  })
})

describe('validateTodo', () => {
  const input: TodoInput = {
    title: 'Sprint plan',
    description: '',
    priority: 'medium',
    due_date: null,
    completed: false,
  }

  it('accepts a valid task with limits reached and a real due date', () => {
    expect(
      validateTodo({
        ...input,
        title: ` ${'t'.repeat(120)} `,
        description: 'd'.repeat(2000),
        due_date: '2028-02-29',
      }),
    ).toEqual({})
  })

  it.each([
    ['an empty title', { title: '' }, { title: 'Enter a task title.' }],
    ['a blank title', { title: '   ' }, { title: 'Enter a task title.' }],
    [
      'a long title',
      { title: 't'.repeat(121) },
      { title: 'The title must be at most 120 characters.' },
    ],
    [
      'a long description',
      { description: 'd'.repeat(2001) },
      { description: 'The description must be at most 2000 characters.' },
    ],
    [
      'a wrongly formatted date',
      { due_date: '15/10/2026' },
      { due_date: 'Enter a valid date.' },
    ],
    [
      'an impossible month',
      { due_date: '2026-13-01' },
      { due_date: 'Enter a valid date.' },
    ],
    [
      'a day that does not exist',
      { due_date: '2026-02-30' },
      { due_date: 'Enter a valid date.' },
    ],
  ])('reports %s', (_, change, errors) => {
    expect(validateTodo({ ...input, ...change })).toEqual(errors)
  })

  it('reports every invalid field at once', () => {
    expect(
      validateTodo({
        ...input,
        title: '',
        description: 'd'.repeat(2001),
        due_date: 'soon',
      }),
    ).toEqual({
      title: 'Enter a task title.',
      description: 'The description must be at most 2000 characters.',
      due_date: 'Enter a valid date.',
    })
  })
})

describe('isOverdue', () => {
  afterEach(() => vi.useRealTimers())

  it('flags only active tasks due before today (local time)', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 10, 12) })
    expect(isOverdue({ ...base, due_date: '2026-10-09' })).toBe(true)
    expect(isOverdue({ ...base, due_date: '2026-10-10' })).toBe(false)
    expect(isOverdue({ ...base, due_date: '2026-10-11' })).toBe(false)
    expect(
      isOverdue({ ...base, due_date: '2026-10-09', completed: true }),
    ).toBe(false)
    expect(isOverdue(base)).toBe(false)
  })

  it('uses the local calendar day just after midnight', () => {
    vi.useFakeTimers({ now: new Date(2026, 0, 1, 0, 5) })
    expect(isOverdue({ ...base, due_date: '2025-12-31' })).toBe(true)
    expect(isOverdue({ ...base, due_date: '2026-01-01' })).toBe(false)
  })
})

describe('formatDate', () => {
  it.each([
    ['2026-10-15', '15 Oct 2026'],
    ['2026-01-01', '1 Jan 2026'],
    ['2026-12-31', '31 Dec 2026'],
  ])('formats %s as %s', (date, formatted) => {
    expect(formatDate(date)).toBe(formatted)
  })
})
