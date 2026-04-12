import { demoCourses, demoInvitations, demoLessons, demoProgress } from './mockLms'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type {
  Course,
  Invitation,
  InviteApiRequestLog,
  InviteEmailLog,
  Lesson,
  WatchProgress,
} from '../types/lms'

type DbCourse = {
  id: string
  title: string
  description: string
  thumbnail_url: string
  is_published: boolean
}

type DbLesson = {
  id: string
  course_id: string
  title: string
  youtube_video_id: string
  order: number
  is_published: boolean
}

type DbProgress = {
  user_id: string
  lesson_id: string
  watched_seconds: number
  total_seconds: number
  is_completed: boolean
  updated_at: string
}

type DbInvitation = {
  id: string
  email: string
  invited_by: string
  status: Invitation['status']
  expires_at: string
  token: string
}

type DbInviteEmailLog = {
  id: string
  invitation_id: string | null
  email: string
  action: 'create' | 'resend'
  status: 'success' | 'failed'
  error_detail: string | null
  attempts: number
  created_at: string
}

type DbInviteApiRequestLog = {
  id: string
  triggered_by: string | null
  source_ip: string | null
  action: 'create' | 'resend' | 'revoke'
  allowed: boolean
  reason: string | null
  created_at: string
}

export type AcceptInvitationResult = 'accepted' | 'invalid' | 'expired' | 'already-used' | 'email-mismatch'

const inviteWebhook = import.meta.env.VITE_INVITE_EMAIL_WEBHOOK as string | undefined
const inviteWebhookTimeoutMs = Number(import.meta.env.VITE_INVITE_WEBHOOK_TIMEOUT_MS ?? '8000')
const inviteWebhookMaxRetries = Number(import.meta.env.VITE_INVITE_WEBHOOK_RETRIES ?? '2')
const inviteWebhookSecret = import.meta.env.VITE_INVITE_WEBHOOK_SECRET as string | undefined
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

type InviteNotificationResult = {
  ok: boolean
  error?: string
}

type InviteApiError = Error & {
  retryAfterSec?: number
}

type AdminInviteApiResponse = {
  invitation: Invitation
}

type AdminEmailLogsApiResponse = {
  emailLogs: DbInviteEmailLog[]
  nextCursor?: string | null
  hasMore?: boolean
  totalCount?: number | null
}

type AdminApiLogsApiResponse = {
  apiLogs: DbInviteApiRequestLog[]
  nextCursor?: string | null
  hasMore?: boolean
  totalCount?: number | null
}

const toBase64 = (value: string) => {
  if (typeof btoa === 'function') return btoa(value)

  // Fallback for very old runtimes: encode as UTF-8 bytes then base64.
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary)
}

const encodeCursor = (createdAt: string, id: string) => {
  return toBase64(JSON.stringify({ createdAt, id }))
}

export const getRetryAfterSecFromError = (error: unknown): number | null => {
  if (!(error instanceof Error)) return null
  const candidate = (error as InviteApiError).retryAfterSec
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return null
  return Math.max(1, Math.floor(candidate))
}

const toHex = (bytes: Uint8Array) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')

const signInvitePayload = async (body: string, timestamp: string) => {
  if (!inviteWebhookSecret) return null

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(inviteWebhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const message = `${timestamp}.${body}`
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return toHex(new Uint8Array(signature))
}

const toCourse = (row: DbCourse): Course => ({
  id: row.id,
  title: row.title,
  description: row.description,
  thumbnailUrl: row.thumbnail_url,
  isPublished: row.is_published,
})

const toLesson = (row: DbLesson): Lesson => ({
  id: row.id,
  courseId: row.course_id,
  title: row.title,
  youtubeVideoId: row.youtube_video_id,
  order: row.order,
  isPublished: row.is_published,
})

const toProgress = (row: DbProgress): WatchProgress => ({
  userId: row.user_id,
  lessonId: row.lesson_id,
  watchedSeconds: row.watched_seconds,
  totalSeconds: row.total_seconds,
  isCompleted: row.is_completed,
  updatedAt: row.updated_at,
})

const toInvitation = (row: DbInvitation): Invitation => ({
  id: row.id,
  email: row.email,
  invitedBy: row.invited_by,
  status: row.status,
  expiresAt: row.expires_at,
  token: row.token,
  inviteLink: buildInviteLink(row.token),
})

const toInviteEmailLog = (row: DbInviteEmailLog): InviteEmailLog => ({
  id: row.id,
  invitationId: row.invitation_id ?? undefined,
  email: row.email,
  action: row.action,
  status: row.status,
  errorDetail: row.error_detail ?? undefined,
  attempts: row.attempts,
  createdAt: row.created_at,
})

const toInviteApiRequestLog = (row: DbInviteApiRequestLog): InviteApiRequestLog => ({
  id: row.id,
  triggeredBy: row.triggered_by ?? undefined,
  sourceIp: row.source_ip ?? undefined,
  action: row.action,
  allowed: row.allowed,
  reason: row.reason ?? undefined,
  createdAt: row.created_at,
})

const buildApiUrl = (path: string) => {
  if (!apiBaseUrl) return path
  const trimmedBase = apiBaseUrl.replace(/\/+$/, '')
  const trimmedPath = path.startsWith('/') ? path : `/${path}`
  return `${trimmedBase}${trimmedPath}`
}

const buildInviteLink = (token: string) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/invite/accept?token=${token}`
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const getAccessToken = async () => {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

  const callAdminLogsApi = async (params: {
    type: 'email' | 'api'
    limit?: number
    hours?: number
    cursor?: string
    action?: string
    status?: string
    allowed?: string
    email?: string
    triggeredBy?: string
    sourceIp?: string
    sort?: 'asc' | 'desc'
  }) => {
  const accessToken = await getAccessToken()
  if (!accessToken) {
    throw new Error('管理者セッションが取得できません。再ログインしてください。')
  }

  const query = new URLSearchParams({ type: params.type })
  if (typeof params.limit === 'number') query.set('limit', String(params.limit))
  if (typeof params.hours === 'number' && params.hours > 0) query.set('hours', String(params.hours))
  if (params.cursor) query.set('cursor', params.cursor)
  if (params.action) query.set('action', params.action)
  if (params.status) query.set('status', params.status)
  if (params.allowed) query.set('allowed', params.allowed)
  if (params.email) query.set('email', params.email)
  if (params.triggeredBy) query.set('triggeredBy', params.triggeredBy)
  if (params.sourceIp) query.set('sourceIp', params.sourceIp)
  if (params.sort) query.set('sort', params.sort)

  const response = await fetch(buildApiUrl(`/api/admin-logs?${query.toString()}`), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    let message = '監査ログ取得に失敗しました。'
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Keep default message.
    }
    throw new Error(message)
  }

  return response.json()
}

const callAdminInvitationApi = async (
  action: 'create' | 'resend' | 'revoke',
  payload: Record<string, string>,
) => {
  const accessToken = await getAccessToken()
  if (!accessToken) {
    throw new Error('管理者セッションが取得できません。再ログインしてください。')
  }

  const response = await fetch(buildApiUrl('/api/admin-invitations'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action, ...payload }),
  })

  if (!response.ok) {
    let message = '招待APIの呼び出しに失敗しました。'
    let retryAfterSec: number | null = null
    try {
      const errorBody = (await response.json()) as { error?: string; retryAfterSec?: number }
      if (errorBody.error) {
        message = errorBody.error
      }
      if (typeof errorBody.retryAfterSec === 'number' && Number.isFinite(errorBody.retryAfterSec)) {
        retryAfterSec = Math.max(1, Math.floor(errorBody.retryAfterSec))
      }
    } catch {
      // Keep default message.
    }

    if (response.status === 429 && retryAfterSec) {
      message = `${message}（約${retryAfterSec}秒後に再試行してください）`
    }

    const apiError = new Error(message) as InviteApiError
    if (response.status === 429 && retryAfterSec) {
      apiError.retryAfterSec = retryAfterSec
    }
    throw apiError
  }

  const json = (await response.json()) as AdminInviteApiResponse
  return json.invitation
}

const sendInviteNotification = async (invitation: Invitation) => {
  if (!inviteWebhook || !invitation.inviteLink) {
    return { ok: true } as InviteNotificationResult
  }

  let lastError: unknown = null
  const attempts = Math.max(1, inviteWebhookMaxRetries + 1)

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), inviteWebhookTimeoutMs)

    try {
      const payload = JSON.stringify({
        type: 'invite',
        email: invitation.email,
        inviteLink: invitation.inviteLink,
        expiresAt: invitation.expiresAt,
      })
      const timestamp = String(Date.now())
      const signature = await signInvitePayload(payload, timestamp)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (signature) {
        headers['x-invite-timestamp'] = timestamp
        headers['x-invite-signature'] = signature
      }

      const response = await fetch(inviteWebhook, {
      method: 'POST',
      signal: controller.signal,
        headers,
        body: payload,
      })

      window.clearTimeout(timeout)
      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`)
      }

      return { ok: true } as InviteNotificationResult
    } catch (error) {
      window.clearTimeout(timeout)
      lastError = error

      if (attempt < attempts - 1) {
        await wait(300 * (attempt + 1))
      }
    }
  }

  console.warn('Invite notification webhook failed after retries', lastError)
  return {
    ok: false,
    error: lastError instanceof Error ? lastError.message : '招待通知の送信に失敗しました。',
  } as InviteNotificationResult
}

const isExpired = (expiresAt: string) => new Date(expiresAt).getTime() < Date.now()

export const expirePendingInvitations = async () => {
  if (!isSupabaseConfigured || !supabase) {
    let updated = 0
    demoInvitations.forEach((item) => {
      if (item.status === 'pending' && isExpired(item.expiresAt)) {
        item.status = 'expired'
        updated += 1
      }
    })
    return updated
  }

  const { data, error } = await supabase.rpc('expire_pending_invitations')
  if (!error && typeof data === 'number') {
    return data
  }

  const { data: staleRows, error: selectError } = await supabase
    .from('invitations')
    .select('id')
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())

  if (selectError || !staleRows || staleRows.length === 0) {
    return 0
  }

  const staleIds = staleRows.map((row) => row.id)
  await supabase.from('invitations').update({ status: 'expired' }).in('id', staleIds)
  return staleIds.length
}

const toExpiredIfNeeded = (invitation: Invitation) => {
  if (invitation.status === 'pending' && isExpired(invitation.expiresAt)) {
    return { ...invitation, status: 'expired' as const }
  }
  return invitation
}

export const getInvitationByToken = async (token: string) => {
  if (!isSupabaseConfigured || !supabase) {
    const invitation = demoInvitations.find((item) => item.token === token)
    if (!invitation) return null
    if (invitation.status === 'pending' && isExpired(invitation.expiresAt)) {
      invitation.status = 'expired'
    }
    return invitation
  }

  const { data, error } = await supabase
    .from('invitations')
    .select('id, email, invited_by, status, expires_at, token')
    .eq('token', token)
    .maybeSingle()

  if (error || !data) return null

  const invitation = toExpiredIfNeeded(toInvitation(data as DbInvitation))
  if (invitation.status === 'expired') {
    await supabase.from('invitations').update({ status: 'expired' }).eq('id', invitation.id)
  }

  return invitation
}

export const listCourses = async () => {
  if (!isSupabaseConfigured || !supabase) {
    return [...demoCourses]
  }

  const { data, error } = await supabase.from('courses').select('id, title, description, thumbnail_url, is_published').order('created_at', { ascending: false })

  if (error) throw error
  return (data as DbCourse[]).map(toCourse)
}

export const createCourse = async (input: { title: string; description: string }) => {
  if (!isSupabaseConfigured || !supabase) {
    const course: Course = {
      id: crypto.randomUUID(),
      title: input.title,
      description: input.description || '説明未設定',
      thumbnailUrl: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=1200&q=80',
      isPublished: false,
    }
    demoCourses.unshift(course)
    return course
  }

  const { data, error } = await supabase
    .from('courses')
    .insert({
      title: input.title,
      description: input.description || '',
      thumbnail_url: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=1200&q=80',
      is_published: false,
    })
    .select('id, title, description, thumbnail_url, is_published')
    .single()

  if (error) throw error
  return toCourse(data as DbCourse)
}

export const listLessonsByCourse = async (courseId: string) => {
  if (!isSupabaseConfigured || !supabase) {
    return demoLessons.filter((lesson) => lesson.courseId === courseId).sort((a, b) => a.order - b.order)
  }

  const { data, error } = await supabase
    .from('lessons')
    .select('id, course_id, title, youtube_video_id, order, is_published')
    .eq('course_id', courseId)
    .order('order', { ascending: true })

  if (error) throw error
  return (data as DbLesson[]).map(toLesson)
}

export const findLesson = async (lessonId: string) => {
  if (!isSupabaseConfigured || !supabase) {
    return demoLessons.find((lesson) => lesson.id === lessonId) ?? null
  }

  const { data, error } = await supabase
    .from('lessons')
    .select('id, course_id, title, youtube_video_id, order, is_published')
    .eq('id', lessonId)
    .single()

  if (error) return null
  return toLesson(data as DbLesson)
}

export const listProgressByUser = async (userId: string) => {
  if (!isSupabaseConfigured || !supabase) {
    return demoProgress.filter((item) => item.userId === userId)
  }

  const { data, error } = await supabase
    .from('watch_progress')
    .select('user_id, lesson_id, watched_seconds, total_seconds, is_completed, updated_at')
    .eq('user_id', userId)

  if (error) throw error
  return (data as DbProgress[]).map(toProgress)
}

export const saveWatchProgress = async (payload: {
  userId: string
  lessonId: string
  watchedSeconds: number
  totalSeconds?: number
  isCompleted?: boolean
}) => {
  const record: WatchProgress = {
    userId: payload.userId,
    lessonId: payload.lessonId,
    watchedSeconds: payload.watchedSeconds,
    totalSeconds: payload.totalSeconds ?? 0,
    isCompleted: payload.isCompleted ?? false,
    updatedAt: new Date().toISOString(),
  }

  if (!isSupabaseConfigured || !supabase) {
    const existing = demoProgress.find(
      (item) => item.userId === payload.userId && item.lessonId === payload.lessonId,
    )

    if (existing) {
      existing.watchedSeconds = record.watchedSeconds
      existing.totalSeconds = record.totalSeconds
      existing.isCompleted = record.isCompleted
      existing.updatedAt = record.updatedAt
      return existing
    }

    demoProgress.push(record)
    return record
  }

  const { data, error } = await supabase
    .from('watch_progress')
    .upsert(
      {
        user_id: payload.userId,
        lesson_id: payload.lessonId,
        watched_seconds: payload.watchedSeconds,
        total_seconds: payload.totalSeconds ?? 0,
        is_completed: payload.isCompleted ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,lesson_id' },
    )
    .select('user_id, lesson_id, watched_seconds, total_seconds, is_completed, updated_at')
    .single()

  if (error) throw error
  return toProgress(data as DbProgress)
}

export const listInvitations = async () => {
  await expirePendingInvitations()

  if (!isSupabaseConfigured || !supabase) {
    return demoInvitations.map((item) => {
      return {
        ...item,
        inviteLink: item.token ? buildInviteLink(item.token) : undefined,
      }
    })
  }

  const { data, error } = await supabase
    .from('invitations')
    .select('id, email, invited_by, status, expires_at, token')
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data as DbInvitation[]).map(toInvitation)
}

export const listInviteEmailLogsPage = async (options?: {
  limit?: number
  hours?: number
  cursor?: string
  action?: 'all' | 'create' | 'resend'
  status?: 'all' | 'success' | 'failed'
  email?: string
  sort?: 'asc' | 'desc'
}): Promise<{ items: InviteEmailLog[]; nextCursor: string | null; hasMore: boolean; totalCount: number | null }> => {
  if (!isSupabaseConfigured || !supabase) {
    return { items: [], nextCursor: null, hasMore: false, totalCount: null }
  }

  const payload = (await callAdminLogsApi({
    type: 'email',
    limit: options?.limit,
    hours: options?.hours,
    cursor: options?.cursor,
    action: options?.action,
    status: options?.status,
    email: options?.email,
    sort: options?.sort,
  })) as AdminEmailLogsApiResponse

  const items = (payload.emailLogs ?? []).map(toInviteEmailLog)
  const totalCount = typeof payload.totalCount === 'number' ? payload.totalCount : null
  const hasMore =
    Boolean(payload.hasMore) || (typeof totalCount === 'number' ? items.length < totalCount : false)
  const nextCursor =
    payload.nextCursor ??
    (hasMore && items.length > 0 ? encodeCursor(items[items.length - 1].createdAt, items[items.length - 1].id) : null)

  return { items, nextCursor, hasMore, totalCount }
}

export const listInviteEmailLogs = async (options?: {
  limit?: number
  hours?: number
  action?: 'all' | 'create' | 'resend'
  status?: 'all' | 'success' | 'failed'
  email?: string
}): Promise<InviteEmailLog[]> => {
  const page = await listInviteEmailLogsPage(options)
  return page.items
}

export const listInviteApiRequestLogsPage = async (options?: {
  limit?: number
  hours?: number
  cursor?: string
  action?: 'all' | 'create' | 'resend' | 'revoke'
  allowed?: 'all' | 'allowed' | 'blocked'
  triggeredBy?: string
  sourceIp?: string
  sort?: 'asc' | 'desc'
}): Promise<{ items: InviteApiRequestLog[]; nextCursor: string | null; hasMore: boolean; totalCount: number | null }> => {
  if (!isSupabaseConfigured || !supabase) {
    return { items: [], nextCursor: null, hasMore: false, totalCount: null }
  }

  const payload = (await callAdminLogsApi({
    type: 'api',
    limit: options?.limit,
    hours: options?.hours,
    cursor: options?.cursor,
    action: options?.action,
    allowed: options?.allowed,
    triggeredBy: options?.triggeredBy,
    sourceIp: options?.sourceIp,
    sort: options?.sort,
  })) as AdminApiLogsApiResponse

  const items = (payload.apiLogs ?? []).map(toInviteApiRequestLog)
  const totalCount = typeof payload.totalCount === 'number' ? payload.totalCount : null
  const hasMore =
    Boolean(payload.hasMore) || (typeof totalCount === 'number' ? items.length < totalCount : false)
  const nextCursor =
    payload.nextCursor ??
    (hasMore && items.length > 0 ? encodeCursor(items[items.length - 1].createdAt, items[items.length - 1].id) : null)

  return { items, nextCursor, hasMore, totalCount }
}

export const listInviteApiRequestLogs = async (options?: {
  limit?: number
  hours?: number
  action?: 'all' | 'create' | 'resend' | 'revoke'
  allowed?: 'all' | 'allowed' | 'blocked'
  triggeredBy?: string
  sourceIp?: string
}): Promise<InviteApiRequestLog[]> => {
  const page = await listInviteApiRequestLogsPage(options)
  return page.items
}

export const createInvitation = async (payload: { email: string; invitedBy: string }) => {
  const token = crypto.randomUUID()

  if (!isSupabaseConfigured || !supabase) {
    const invitation: Invitation = {
      id: crypto.randomUUID(),
      email: payload.email,
      invitedBy: payload.invitedBy,
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      token,
      inviteLink: buildInviteLink(token),
    }

    demoInvitations.unshift(invitation)
    const notify = await sendInviteNotification(invitation)
    if (!notify.ok) {
      invitation.notificationError = notify.error
    }
    return invitation
  }

  return callAdminInvitationApi('create', {
    email: payload.email,
    invitedBy: payload.invitedBy,
  })
}

export const resendInvitation = async (invitationId: string) => {
  if (!isSupabaseConfigured || !supabase) {
    const invitation = demoInvitations.find((item) => item.id === invitationId)
    if (!invitation) throw new Error('招待データが見つかりません')

    const renewedToken = crypto.randomUUID()
    invitation.token = renewedToken
    invitation.status = 'pending'
    invitation.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    invitation.inviteLink = buildInviteLink(renewedToken)
    const notify = await sendInviteNotification(invitation)
    invitation.notificationError = notify.ok ? undefined : notify.error
    return invitation
  }

  return callAdminInvitationApi('resend', { invitationId })
}

export const revokeInvitation = async (invitationId: string, email: string) => {
  if (!isSupabaseConfigured || !supabase) {
    const invitation = demoInvitations.find((item) => item.id === invitationId)
    if (!invitation) throw new Error('招待データが見つかりません')
    invitation.status = 'revoked'
    return invitation
  }

  return callAdminInvitationApi('revoke', { invitationId, email })
}

export const acceptInvitationToken = async (payload: {
  token: string
  userEmail: string
  userId: string
}): Promise<AcceptInvitationResult> => {
  if (!isSupabaseConfigured || !supabase) {
    const invitation = demoInvitations.find((item) => item.token === payload.token)
    if (!invitation) return 'invalid'
    if (invitation.status !== 'pending') return 'already-used'
    if (isExpired(invitation.expiresAt)) {
      invitation.status = 'expired'
      return 'expired'
    }
    if (invitation.email.toLowerCase() !== payload.userEmail.toLowerCase()) return 'email-mismatch'

    invitation.status = 'accepted'
    return 'accepted'
  }

  const invitation = await getInvitationByToken(payload.token)
  if (!invitation || !invitation.id) return 'invalid'
  if (invitation.status !== 'pending') return 'already-used'
  if (isExpired(invitation.expiresAt)) {
    await supabase.from('invitations').update({ status: 'expired' }).eq('id', invitation.id)
    return 'expired'
  }
  if (invitation.email.toLowerCase() !== payload.userEmail.toLowerCase()) return 'email-mismatch'

  const acceptedAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('invitations')
    .update({ status: 'accepted', accepted_at: acceptedAt, used_at: acceptedAt })
    .eq('id', invitation.id)

  if (updateError) return 'invalid'

  await supabase
    .from('allowed_emails')
    .upsert({ email: payload.userEmail, created_by: payload.userId }, { onConflict: 'email' })

  await supabase
    .from('profiles')
    .upsert(
      {
        id: payload.userId,
        email: payload.userEmail,
        name: payload.userEmail,
        role: 'learner',
        is_active: true,
      },
      { onConflict: 'id' },
    )

  return 'accepted'
}
