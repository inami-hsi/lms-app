/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'crypto'

type Action = 'create' | 'resend' | 'revoke' | 'expire'

type RequestBody = {
  action?: Action
  email?: string
  invitedBy?: string
  invitationId?: string
  sendEmail?: boolean
}

type InvitationResponse = {
  id: string
  email: string
  invitedBy: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  expiresAt: string
  token?: string
  inviteLink?: string
  notificationError?: string
}

type SendInviteEmailResult = {
  ok: boolean
  error?: string
  attempts: number
}

type DbInvitation = {
  id: string
  email: string
  invited_by: string
  status: InvitationResponse['status']
  expires_at: string
}

const getHeader = (req: any, name: string) => {
  const lower = name.toLowerCase()
  const headers = req?.headers ?? {}

  if (typeof headers?.get === 'function') {
    const value = headers.get(lower)
    return typeof value === 'string' ? value : null
  }

  const raw = headers[lower] ?? headers[name] ?? headers[name.toUpperCase()]
  if (Array.isArray(raw)) return typeof raw[0] === 'string' ? raw[0] : null
  return typeof raw === 'string' ? raw : null
}

const toRequestUrl = (req: any) => {
  if (typeof req?.url === 'string' && /^https?:\/\//.test(req.url)) {
    return new URL(req.url)
  }

  // Vercel Node runtime: req.url is a path like "/api/..", so we reconstruct it.
  const proto = getHeader(req, 'x-forwarded-proto') ?? 'https'
  const host = getHeader(req, 'x-forwarded-host') ?? getHeader(req, 'host') ?? 'localhost'
  const path = typeof req?.url === 'string' ? req.url : '/'
  return new URL(`${proto}://${host}${path}`)
}

const getCorsOrigin = (req: any) => {
  const origin = getHeader(req, 'origin')
  if (!origin) return null

  const allowed = new Set(
    String(process.env.CORS_ALLOWED_ORIGINS ?? 'https://lms.ai-nagoya.com')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )

  if (process.env.NODE_ENV !== 'production') {
    allowed.add('http://localhost:3000')
    allowed.add('http://localhost:5173')
    allowed.add('http://127.0.0.1:5173')
  }
  return allowed.has(origin) ? origin : null
}

const buildCorsHeaders = (req: any) => {
  const origin = getCorsOrigin(req)
  if (!origin) return {}

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type,apikey,x-client-info',
    Vary: 'Origin',
  } as Record<string, string>
}

const json = (req: any, status: number, body: Record<string, unknown>, res?: any) => {
  const corsHeaders = buildCorsHeaders(req)

  if (res && typeof res.status === 'function') {
    res.status(status)
    res.setHeader('Cache-Control', 'no-store')
    for (const [key, value] of Object.entries(corsHeaders)) {
      res.setHeader(key, value)
    }
    return res.json(body)
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  })
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const RATE_LIMIT_WINDOW_SEC = Number(process.env.INVITE_RATE_LIMIT_WINDOW_SEC ?? '60')
const RATE_LIMIT_USER_MAX = Number(process.env.INVITE_RATE_LIMIT_USER_MAX ?? '20')
const RATE_LIMIT_IP_MAX = Number(process.env.INVITE_RATE_LIMIT_IP_MAX ?? '40')

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex')

const createInviteLink = (token: string, req: Request) => {
  const appBaseUrl = process.env.APP_BASE_URL
  if (appBaseUrl) {
    return `${appBaseUrl.replace(/\/$/, '')}/invite/accept?token=${token}`
  }

  const origin = getHeader(req, 'origin') ?? toRequestUrl(req).origin
  return `${origin}/invite/accept?token=${token}`
}

const buildHtml = (inviteLink: string, expiresAt: string) => {
  const expiration = new Date(expiresAt).toLocaleString('ja-JP')
  return `
    <div style="font-family: Inter, 'Noto Sans JP', sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin-bottom: 8px;">LMS 招待のお知らせ</h2>
      <p>以下のリンクから受講登録を完了してください。</p>
      <p>
        <a href="${inviteLink}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2563eb;color:#ffffff;text-decoration:none;">
          招待を受諾する
        </a>
      </p>
      <p>有効期限: ${expiration}</p>
      <p style="font-size:12px;color:#6b7280;">このメールに心当たりがない場合は破棄してください。</p>
    </div>
  `
}

const sendInviteEmail = async (input: { email: string; inviteLink: string; expiresAt: string }): Promise<SendInviteEmailResult> => {
  const resendApiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.INVITE_FROM_EMAIL ?? 'LMS <onboarding@resend.dev>'
  const timeoutMs = Number(process.env.RESEND_TIMEOUT_MS ?? '10000')
  const retries = Number(process.env.RESEND_RETRIES ?? '2')

  if (!resendApiKey) {
    return { ok: false, error: 'RESEND_API_KEY が未設定です。', attempts: 0 }
  }

  const attempts = Math.max(1, retries + 1)
  let lastError = '招待メール送信に失敗しました。'

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: input.email,
          subject: '【LMS】受講招待のお知らせ',
          html: buildHtml(input.inviteLink, input.expiresAt),
        }),
      })

      clearTimeout(timeout)
      if (!response.ok) {
        let detail = ''
        try {
          const text = await response.text()
          // Resend usually returns JSON, but keep it robust.
          try {
            const parsed = JSON.parse(text) as { message?: unknown; error?: unknown }
            const msg =
              (typeof parsed?.message === 'string' && parsed.message) ||
              (typeof parsed?.error === 'string' && parsed.error) ||
              ''
            detail = msg || text
          } catch {
            detail = text
          }
        } catch {
          detail = ''
        }

        const normalized = detail ? detail.replace(/\s+/g, ' ').trim() : ''
        const clipped = normalized ? normalized.slice(0, 240) : ''
        lastError = clipped ? `Resend API error: ${response.status} (${clipped})` : `Resend API error: ${response.status}`
        if (attempt < attempts - 1) {
          await wait(400 * (attempt + 1))
        }
        continue
      }

      return { ok: true, attempts: attempt + 1 }
    } catch (error) {
      clearTimeout(timeout)
      lastError = error instanceof Error ? error.message : 'unknown error'
      if (attempt < attempts - 1) {
        await wait(400 * (attempt + 1))
      }
    }
  }

  return { ok: false, error: lastError, attempts }
}

const logInviteEmail = async (params: {
  adminClient: ReturnType<typeof createClient>
  invitationId: string
  email: string
  action: 'create' | 'resend'
  status: 'success' | 'failed'
  errorDetail?: string
  attempts: number
  triggeredBy: string
}) => {
  const baseRow = {
    invitation_id: params.invitationId,
    email: params.email,
    action: params.action,
    status: params.status,
    error_detail: params.errorDetail ?? null,
    attempts: params.attempts,
    triggered_by: params.triggeredBy,
    created_at: new Date().toISOString(),
  }

  // The table schema may differ between environments; try a couple of fallbacks so we still keep an audit trail.
  const tries: Array<Record<string, unknown>> = [
    baseRow,
    // Older schema fallback (no triggered_by / invitation_id).
    {
      invitation_id: params.invitationId,
      email: params.email,
      action: params.action,
      status: params.status,
      error_detail: params.errorDetail ?? null,
      attempts: params.attempts,
      created_at: baseRow.created_at,
    },
    {
      email: params.email,
      action: params.action,
      status: params.status,
      error_detail: params.errorDetail ?? null,
      attempts: params.attempts,
      created_at: baseRow.created_at,
    },
  ]

  for (const row of tries) {
    const { error } = await params.adminClient.from('invite_email_logs').insert(row)
    if (!error) return { ok: true as const }
    // Keep the last error, but don't throw; email sending itself should not be blocked by logging failures.
    console.error('logInviteEmail insert failed', error)
  }

  return { ok: false as const }
}

const toInvitation = (row: DbInvitation, req: any, token?: string): InvitationResponse => ({
  id: row.id,
  email: row.email,
  invitedBy: row.invited_by,
  status: row.status,
  expiresAt: row.expires_at,
  ...(token ? { token, inviteLink: createInviteLink(token, req) } : {}),
})

const getBearerToken = (req: any) => {
  const authHeader = getHeader(req, 'authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  return authHeader.slice(7)
}

const getSourceIp = (req: any) => {
  const forwarded = getHeader(req, 'x-forwarded-for')
  if (forwarded) {
    const firstIp = forwarded.split(',')[0]?.trim()
    if (firstIp) return firstIp
  }

  return getHeader(req, 'x-real-ip') ?? 'unknown'
}

const countRecentLogs = async (params: {
  adminClient: ReturnType<typeof createClient>
  action: Action
  fromIso: string
  userId: string
  sourceIp: string
}) => {
  const { count: userCount } = await params.adminClient
    .from('invite_api_request_logs')
    .select('id', { count: 'exact', head: true })
    .eq('action', params.action)
    .eq('triggered_by', params.userId)
    .gte('created_at', params.fromIso)

  const { count: ipCount } = await params.adminClient
    .from('invite_api_request_logs')
    .select('id', { count: 'exact', head: true })
    .eq('action', params.action)
    .eq('source_ip', params.sourceIp)
    .gte('created_at', params.fromIso)

  return {
    userCount: userCount ?? 0,
    ipCount: ipCount ?? 0,
  }
}

const logInviteApiRequest = async (params: {
  adminClient: ReturnType<typeof createClient>
  userId: string
  sourceIp: string
  action: Action
  allowed: boolean
  reason?: string
}) => {
  await params.adminClient.from('invite_api_request_logs').insert({
    triggered_by: params.userId,
    source_ip: params.sourceIp,
    action: params.action,
    allowed: params.allowed,
    reason: params.reason ?? null,
  })
}

const checkRateLimit = async (params: {
  adminClient: ReturnType<typeof createClient>
  userId: string
  sourceIp: string
  action: Action
}) => {
  const fromIso = new Date(Date.now() - RATE_LIMIT_WINDOW_SEC * 1000).toISOString()
  const { userCount, ipCount } = await countRecentLogs({
    adminClient: params.adminClient,
    action: params.action,
    fromIso,
    userId: params.userId,
    sourceIp: params.sourceIp,
  })

  if (userCount >= RATE_LIMIT_USER_MAX) {
    await logInviteApiRequest({
      adminClient: params.adminClient,
      userId: params.userId,
      sourceIp: params.sourceIp,
      action: params.action,
      allowed: false,
      reason: 'user-rate-limit',
    })
    return { allowed: false as const, error: 'リクエストが多すぎます。1分ほど待ってから再試行してください。' }
  }

  if (ipCount >= RATE_LIMIT_IP_MAX) {
    await logInviteApiRequest({
      adminClient: params.adminClient,
      userId: params.userId,
      sourceIp: params.sourceIp,
      action: params.action,
      allowed: false,
      reason: 'ip-rate-limit',
    })
    return { allowed: false as const, error: 'アクセス元IPのリクエスト上限に達しました。時間をおいて再試行してください。' }
  }

  await logInviteApiRequest({
    adminClient: params.adminClient,
    userId: params.userId,
    sourceIp: params.sourceIp,
    action: params.action,
    allowed: true,
  })

  return { allowed: true as const }
}

const ensureAdmin = async (req: any) => {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return { ok: false as const, status: 500, error: 'Supabase server env is not configured.' }
  }

  const token = getBearerToken(req)
  if (!token) {
    return { ok: false as const, status: 401, error: 'Missing bearer token.' }
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey)
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: userData, error: userError } = await authClient.auth.getUser(token)
  if (userError || !userData?.user) {
    return { ok: false as const, status: 401, error: 'Invalid user session.' }
  }

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileError || !profile) {
    return { ok: false as const, status: 403, error: 'Profile not found.' }
  }

  if (!profile.is_active || profile.role !== 'admin') {
    return { ok: false as const, status: 403, error: 'Admin permission is required.' }
  }

  return {
    ok: true as const,
    adminClient,
    userId: userData.user.id,
  }
}

const readJsonBody = async (req: any): Promise<RequestBody> => {
  if (typeof req?.json === 'function') {
    return (await req.json()) as RequestBody
  }

  if (req?.body != null) {
    if (typeof req.body === 'string') {
      return JSON.parse(req.body) as RequestBody
    }
    return req.body as RequestBody
  }

  // Fallback for Node streams (should be rare on Vercel, but keeps us safe).
  const raw = await new Promise<string>((resolve, reject) => {
    let data = ''
    req.on?.('data', (chunk: Buffer | string) => {
      data += chunk instanceof Buffer ? chunk.toString('utf-8') : String(chunk)
    })
    req.on?.('end', () => resolve(data))
    req.on?.('error', reject)
  })

  if (!raw.trim()) return {}
  return JSON.parse(raw) as RequestBody
}

export default async function handler(req: any, res?: any) {
  if (req.method === 'OPTIONS') {
    const corsHeaders = buildCorsHeaders(req)
    if (res && typeof res.status === 'function') {
      res.status(204)
      for (const [key, value] of Object.entries(corsHeaders)) {
        res.setHeader(key, value)
      }
      return res.end()
    }
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method === 'GET') {
    const authResult = await ensureAdmin(req)
    if (!authResult.ok) {
      return json(req, authResult.status, { error: authResult.error }, res)
    }

    const { adminClient } = authResult
    const { data, error } = await adminClient
      .from('invitations')
      .select('id, email, invited_by, status, expires_at')
      .order('created_at', { ascending: false })

    if (error) {
      return json(req, 500, { error: 'Failed to list invitations.' }, res)
    }

    return json(req, 200, { invitations: (data ?? []).map((row) => toInvitation(row as DbInvitation, req)) }, res)
  }

  if (req.method !== 'POST') {
    return json(req, 405, { error: 'Method not allowed' }, res)
  }

  let body: RequestBody
  try {
    body = await readJsonBody(req)
  } catch {
    return json(req, 400, { error: 'Invalid JSON body.' }, res)
  }

  const authResult = await ensureAdmin(req)
  if (!authResult.ok) {
    return json(req, authResult.status, { error: authResult.error }, res)
  }

  const { adminClient, userId } = authResult
  const sourceIp = getSourceIp(req)

  if (body.action === 'create' || body.action === 'resend' || body.action === 'revoke') {
    const rateResult = await checkRateLimit({
      adminClient,
      userId,
      sourceIp,
      action: body.action,
    })

    if (!rateResult.allowed) {
      return json(
        req,
        429,
        {
          error: rateResult.error,
          retryAfterSec: RATE_LIMIT_WINDOW_SEC,
        },
        res,
      )
    }
  }

  if (body.action === 'create') {
    if (!body.email) {
      return json(req, 400, { error: 'email is required for create.' }, res)
    }

    const token = randomUUID()
    const tokenHash = sha256Hex(token)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await adminClient
      .from('invitations')
      .insert({
        email: body.email,
        invited_by: userId,
        token_hash: tokenHash,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select('id, email, invited_by, status, expires_at')
      .single()

    if (error || !data) {
      return json(req, 500, { error: 'Failed to create invitation.' }, res)
    }

    const invitation = toInvitation(data as DbInvitation, req, token)
    const notify = await sendInviteEmail({
      email: invitation.email,
      inviteLink: invitation.inviteLink!,
      expiresAt: invitation.expiresAt,
    })

    const emailLogResult = await logInviteEmail({
      adminClient,
      invitationId: invitation.id,
      email: invitation.email,
      action: 'create',
      status: notify.ok ? 'success' : 'failed',
      errorDetail: notify.error,
      attempts: notify.attempts,
      triggeredBy: userId,
    })

    if (!notify.ok) {
      invitation.notificationError = notify.error
    } else if (!emailLogResult.ok) {
      invitation.notificationError = '招待ログの記録に失敗しました。管理者に連絡してください。'
    }

    return json(req, 200, { invitation }, res)
  }

  if (body.action === 'resend') {
    if (!body.invitationId) {
      return json(req, 400, { error: 'invitationId is required for resend.' }, res)
    }

    const token = randomUUID()
    const tokenHash = sha256Hex(token)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await adminClient
      .from('invitations')
      .update({ token_hash: tokenHash, status: 'pending', expires_at: expiresAt, accepted_at: null, used_at: null })
      .eq('id', body.invitationId)
      .select('id, email, invited_by, status, expires_at')
      .single()

    if (error || !data) {
      return json(req, 500, { error: 'Failed to resend invitation.' }, res)
    }

    const invitation = toInvitation(data as DbInvitation, req, token)
    const shouldSendEmail = body.sendEmail !== false
    const notify = shouldSendEmail
      ? await sendInviteEmail({
          email: invitation.email,
          inviteLink: invitation.inviteLink!,
          expiresAt: invitation.expiresAt,
        })
      : { ok: true, attempts: 0 }

    const emailLogResult = shouldSendEmail
      ? await logInviteEmail({
          adminClient,
          invitationId: invitation.id,
          email: invitation.email,
          action: 'resend',
          status: notify.ok ? 'success' : 'failed',
          errorDetail: notify.error,
          attempts: notify.attempts,
          triggeredBy: userId,
        })
      : { ok: true as const }

    if (!notify.ok) {
      invitation.notificationError = notify.error
    } else if (!emailLogResult.ok) {
      invitation.notificationError = '招待ログの記録に失敗しました。管理者に連絡してください。'
    }

    return json(req, 200, { invitation }, res)
  }

  if (body.action === 'revoke') {
    if (!body.invitationId || !body.email) {
      return json(req, 400, { error: 'invitationId and email are required for revoke.' }, res)
    }

    const { data, error } = await adminClient
      .from('invitations')
      .update({ status: 'revoked' })
      .eq('id', body.invitationId)
      .select('id, email, invited_by, status, expires_at')
      .single()

    if (error || !data) {
      return json(req, 500, { error: 'Failed to revoke invitation.' }, res)
    }

    await adminClient.from('allowed_emails').delete().eq('email', body.email)

    return json(req, 200, { invitation: toInvitation(data as DbInvitation, req) }, res)
  }

  if (body.action === 'expire') {
    const { data, error } = await adminClient.rpc('expire_pending_invitations')
    if (error) {
      return json(req, 500, { error: 'Failed to expire invitations.' }, res)
    }
    return json(req, 200, { affected: typeof data === 'number' ? data : 0 }, res)
  }

  return json(req, 400, { error: 'Unsupported action.' }, res)
}
