import test from 'node:test'
import assert from 'node:assert/strict'

// Dependency-free tests for the invitation accept decision rules.
//
// The API (`api/invite-accept.ts`) uses these rules:
// - no invitation -> invalid
// - status != pending -> already-used
// - expired -> expired
// - email mismatch -> email-mismatch
// - otherwise -> accepted

const toLower = (value) => String(value ?? '').trim().toLowerCase()

const computeAcceptStatus = ({ invitation, userEmail, now = new Date() }) => {
  if (!invitation) return 'invalid'
  if (invitation.status !== 'pending') return 'already-used'

  const expiresAt = new Date(invitation.expiresAt)
  if (Number.isNaN(expiresAt.getTime())) return 'invalid'
  if (expiresAt.getTime() < now.getTime()) return 'expired'

  if (toLower(invitation.email) !== toLower(userEmail)) return 'email-mismatch'
  return 'accepted'
}

test('invalid when invitation is null', () => {
  assert.equal(computeAcceptStatus({ invitation: null, userEmail: 'a@example.com' }), 'invalid')
})

test('already-used when status is not pending', () => {
  const now = new Date('2026-04-13T00:00:00.000Z')
  const invitation = {
    email: 'a@example.com',
    status: 'accepted',
    expiresAt: '2026-04-20T00:00:00.000Z',
  }
  assert.equal(computeAcceptStatus({ invitation, userEmail: 'a@example.com', now }), 'already-used')
})

test('expired when expiresAt is in the past', () => {
  const now = new Date('2026-04-13T00:00:00.000Z')
  const invitation = {
    email: 'a@example.com',
    status: 'pending',
    expiresAt: '2026-04-12T23:59:59.000Z',
  }
  assert.equal(computeAcceptStatus({ invitation, userEmail: 'a@example.com', now }), 'expired')
})

test('email-mismatch when invitation email differs', () => {
  const now = new Date('2026-04-13T00:00:00.000Z')
  const invitation = {
    email: 'a@example.com',
    status: 'pending',
    expiresAt: '2026-04-20T00:00:00.000Z',
  }
  assert.equal(computeAcceptStatus({ invitation, userEmail: 'b@example.com', now }), 'email-mismatch')
})

test('accepted when pending + not expired + email matches (case-insensitive)', () => {
  const now = new Date('2026-04-13T00:00:00.000Z')
  const invitation = {
    email: 'Inami@Heartline-Inc.com',
    status: 'pending',
    expiresAt: '2026-04-20T00:00:00.000Z',
  }
  assert.equal(computeAcceptStatus({ invitation, userEmail: 'inami@heartline-inc.com', now }), 'accepted')
})

