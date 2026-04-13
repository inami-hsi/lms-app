import test from 'node:test'
import assert from 'node:assert/strict'

// Keep this script dependency-free (no vitest/jest) so it can run on any machine.

const toBase64 = (value) => Buffer.from(value, 'utf-8').toString('base64')
const fromBase64 = (value) => Buffer.from(value, 'base64').toString('utf-8')

const encodeCursor = (createdAt, id) => toBase64(JSON.stringify({ createdAt, id }))

const parseCursor = (value) => {
  if (!value) return null

  try {
    const decoded = fromBase64(value)
    const parsed = JSON.parse(decoded)
    if (typeof parsed?.createdAt !== 'string') return null
    const millis = Date.parse(parsed.createdAt)
    if (Number.isNaN(millis)) return null
    return { createdAt: new Date(millis).toISOString(), id: typeof parsed?.id === 'string' ? parsed.id : null }
  } catch {
    const millis = Date.parse(value)
    if (Number.isNaN(millis)) return null
    return { createdAt: new Date(millis).toISOString(), id: null }
  }
}

const buildCursorClause = (sort, cursor) => {
  if (cursor.id) {
    if (sort === 'asc') {
      return {
        kind: 'or',
        value: `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
      }
    }
    return {
      kind: 'or',
      value: `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    }
  }

  return { kind: sort === 'asc' ? 'gt' : 'lt', column: 'created_at', value: cursor.createdAt }
}

test('encodeCursor -> parseCursor roundtrip (with id)', () => {
  const iso = new Date('2026-04-13T00:00:00.000Z').toISOString()
  const id = 'c62ed067-2b95-4e6e-bb2d-5f43ff56d729'
  const encoded = encodeCursor(iso, id)
  const parsed = parseCursor(encoded)
  assert.deepEqual(parsed, { createdAt: iso, id })
})

test('parseCursor accepts raw ISO8601 string', () => {
  const iso = new Date('2026-04-13T00:00:00.000Z').toISOString()
  const parsed = parseCursor(iso)
  assert.deepEqual(parsed, { createdAt: iso, id: null })
})

test('buildCursorClause uses tie-breaker by id for sort=desc', () => {
  const cursor = { createdAt: '2026-04-13T00:00:00.000Z', id: 'b' }
  const clause = buildCursorClause('desc', cursor)
  assert.equal(clause.kind, 'or')
  assert.deepEqual(clause, {
    kind: 'or',
    value: 'created_at.lt.2026-04-13T00:00:00.000Z,and(created_at.eq.2026-04-13T00:00:00.000Z,id.lt.b)',
  })
})

test('buildCursorClause uses tie-breaker by id for sort=asc', () => {
  const cursor = { createdAt: '2026-04-13T00:00:00.000Z', id: 'b' }
  const clause = buildCursorClause('asc', cursor)
  assert.equal(clause.kind, 'or')
  assert.deepEqual(clause, {
    kind: 'or',
    value: 'created_at.gt.2026-04-13T00:00:00.000Z,and(created_at.eq.2026-04-13T00:00:00.000Z,id.gt.b)',
  })
})

test('buildCursorClause uses created_at only when cursor has no id', () => {
  const cursor = { createdAt: '2026-04-13T00:00:00.000Z', id: null }
  assert.deepEqual(buildCursorClause('asc', cursor), {
    kind: 'gt',
    column: 'created_at',
    value: '2026-04-13T00:00:00.000Z',
  })
  assert.deepEqual(buildCursorClause('desc', cursor), {
    kind: 'lt',
    column: 'created_at',
    value: '2026-04-13T00:00:00.000Z',
  })
})

