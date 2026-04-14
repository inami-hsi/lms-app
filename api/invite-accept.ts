import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

type AcceptInvitationResult = 'accepted' | 'invalid' | 'expired' | 'already-used' | 'email-mismatch'

type RequestBody = {
  token?: string
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
  const proto = getHeader(req, 'x-forwarded-proto') ?? 'https'
  const host = getHeader(req, 'x-forwarded-host') ?? getHeader(req, 'host') ?? 'localhost'
  const path = typeof req?.url === 'string' ? req.url : '/'
  return new URL(`${proto}://${host}${path}`)
}

const getCorsOrigin = (req: any) => {
  const origin = getHeader(req, 'origin')
  if (!origin) return null

  const allowed = new Set([
    'https://lms.ai-nagoya.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ])
  return allowed.has(origin) ? origin : null
}

const buildCorsHeaders = (req: any) => {
  const origin = getCorsOrigin(req)
  if (!origin) return {}

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
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
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders,
    },
  })
}

const getBearerToken = (req: any) => {
  const authHeader = getHeader(req, 'authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex')

const isExpired = (expiresAt: string) => new Date(expiresAt).getTime() < Date.now()

const getSourceIp = (req: any) => {
  const forwarded = getHeader(req, 'x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return getHeader(req, 'x-real-ip') ?? 'unknown'
}

const logAcceptAttempt = async (params: {
  adminClient: ReturnType<typeof createClient>
  userId: string
  sourceIp: string
  allowed: boolean
  reason?: string
}) => {
  try {
    await params.adminClient.from('invite_api_request_logs').insert({
      triggered_by: params.userId,
      source_ip: params.sourceIp,
      action: 'accept',
      allowed: params.allowed,
      reason: params.reason ?? null,
      created_at: new Date().toISOString(),
    })
  } catch (error) {
    // Do not block invite acceptance on logging failures.
    // eslint-disable-next-line no-console
    console.error('invite accept log failed', error)
  }
}

export default async function handler(req: any, res?: any) {
  // Vercel uses Node runtime for these serverless functions.
  return handlerNodeCompat(req, res)
}

const readJsonBody = async (req: any): Promise<RequestBody> => {
  if (typeof req?.json === 'function') {
    return (await req.json()) as RequestBody
  }

  if (req?.body != null) {
    if (typeof req.body === 'string') return JSON.parse(req.body) as RequestBody
    return req.body as RequestBody
  }

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

async function handlerNodeCompat(req: any, res?: any) {
  if (req.method === 'OPTIONS') {
    const corsHeaders = buildCorsHeaders(req)
    if (res && typeof res.status === 'function') {
      res.status(204)
      for (const [key, value] of Object.entries(corsHeaders)) res.setHeader(key, value)
      return res.end()
    }
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json(req, 405, { error: 'Method not allowed' }, res)
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json(req, 500, { error: 'Supabase server env is not configured.' }, res)
  }

  const token = getBearerToken(req)
  if (!token) {
    return json(req, 401, { error: 'Missing bearer token.' }, res)
  }

  let body: RequestBody
  try {
    body = await readJsonBody(req)
  } catch {
    return json(req, 400, { error: 'Invalid JSON body.' }, res)
  }

  const inviteToken = (body.token ?? '').trim()
  if (!inviteToken) {
    return json(req, 400, { error: 'token is required.' }, res)
  }
  const inviteTokenHash = sha256Hex(inviteToken)

  const authClient = createClient(supabaseUrl, supabaseAnonKey)
  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const sourceIp = getSourceIp(req)

  const { data: userData, error: userError } = await authClient.auth.getUser(token)
  if (userError || !userData?.user?.email) {
    await logAcceptAttempt({
      adminClient,
      userId: 'unknown',
      sourceIp,
      allowed: false,
      reason: 'invalid-session',
    })
    return json(req, 401, { error: 'Invalid user session.' }, res)
  }

  const userId = userData.user.id
  const userEmail = userData.user.email

  const { data: invitation, error: inviteError } = await adminClient
    .from('invitations')
    .select('id, email, status, expires_at')
    .eq('token_hash', inviteTokenHash)
    .maybeSingle()

  if (inviteError || !invitation) {
    await logAcceptAttempt({ adminClient, userId, sourceIp, allowed: false, reason: 'invalid-token' })
    return json(req, 200, { status: 'invalid' satisfies AcceptInvitationResult }, res)
  }

  if (invitation.status !== 'pending') {
    await logAcceptAttempt({ adminClient, userId, sourceIp, allowed: false, reason: 'already-used' })
    return json(req, 200, { status: 'already-used' satisfies AcceptInvitationResult }, res)
  }

  if (isExpired(invitation.expires_at)) {
    await adminClient.from('invitations').update({ status: 'expired' }).eq('id', invitation.id)
    await logAcceptAttempt({ adminClient, userId, sourceIp, allowed: false, reason: 'expired' })
    return json(req, 200, { status: 'expired' satisfies AcceptInvitationResult }, res)
  }

  if (String(invitation.email).toLowerCase() !== userEmail.toLowerCase()) {
    await logAcceptAttempt({ adminClient, userId, sourceIp, allowed: false, reason: 'email-mismatch' })
    return json(req, 200, { status: 'email-mismatch' satisfies AcceptInvitationResult }, res)
  }

  const acceptedAt = new Date().toISOString()
  const { error: updateError } = await adminClient
    .from('invitations')
    .update({ status: 'accepted', accepted_at: acceptedAt, used_at: acceptedAt })
    .eq('id', invitation.id)

  if (updateError) {
    await logAcceptAttempt({ adminClient, userId, sourceIp, allowed: false, reason: 'db-error' })
    return json(req, 500, { error: 'Failed to accept invitation.' }, res)
  }

  await logAcceptAttempt({ adminClient, userId, sourceIp, allowed: true })

  await adminClient.from('allowed_emails').upsert(
    { email: userEmail, created_by: userId },
    { onConflict: 'email', ignoreDuplicates: true },
  )

  const { data: existingProfile } = await adminClient
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle()

  if (!existingProfile || existingProfile.role !== 'admin') {
    await adminClient.from('profiles').upsert(
      {
        id: userId,
        email: userEmail,
        name: userData.user.user_metadata?.full_name ?? userEmail,
        role: 'learner',
        is_active: true,
      },
      { onConflict: 'id' },
    )
  }

  return json(req, 200, { status: 'accepted' satisfies AcceptInvitationResult }, res)
}
