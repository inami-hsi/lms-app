import test from 'node:test'
import assert from 'node:assert/strict'

// Dependency-free tests for admin invitation helper rules.

const computeRateLimitDecision = ({ userCount, ipCount, userMax, ipMax }) => {
  if (userCount >= userMax) return { allowed: false, reason: 'user-rate-limit' }
  if (ipCount >= ipMax) return { allowed: false, reason: 'ip-rate-limit' }
  return { allowed: true }
}

const buildInviteLink = ({ appBaseUrl, origin, token }) => {
  if (appBaseUrl) {
    const base = String(appBaseUrl).replace(/\/$/, '')
    return `${base}/invite/accept?token=${token}`
  }
  return `${origin}/invite/accept?token=${token}`
}

test('rate limit blocks by user first when both exceed', () => {
  const result = computeRateLimitDecision({ userCount: 20, ipCount: 999, userMax: 20, ipMax: 40 })
  assert.deepEqual(result, { allowed: false, reason: 'user-rate-limit' })
})

test('rate limit blocks by ip when user is below max', () => {
  const result = computeRateLimitDecision({ userCount: 19, ipCount: 40, userMax: 20, ipMax: 40 })
  assert.deepEqual(result, { allowed: false, reason: 'ip-rate-limit' })
})

test('rate limit allows when both below max', () => {
  const result = computeRateLimitDecision({ userCount: 0, ipCount: 0, userMax: 20, ipMax: 40 })
  assert.deepEqual(result, { allowed: true })
})

test('invite link uses APP_BASE_URL and trims trailing slash', () => {
  const link = buildInviteLink({
    appBaseUrl: 'https://lms.ai-nagoya.com/',
    origin: 'https://ignored.example',
    token: 'abc',
  })
  assert.equal(link, 'https://lms.ai-nagoya.com/invite/accept?token=abc')
})

test('invite link falls back to request origin when APP_BASE_URL is missing', () => {
  const link = buildInviteLink({
    appBaseUrl: '',
    origin: 'https://lms.ai-nagoya.com',
    token: 'abc',
  })
  assert.equal(link, 'https://lms.ai-nagoya.com/invite/accept?token=abc')
})

