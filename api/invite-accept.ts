import { createClient } from '@supabase/supabase-js'

type AcceptInvitationResult = 'accepted' | 'invalid' | 'expired' | 'already-used' | 'email-mismatch'

type RequestBody = {
  token?: string
}

const getCorsOrigin = (req: Request) => {
  const origin = req.headers.get('origin')
  if (!origin) return null

  const allowed = new Set([
    'https://lms.ai-nagoya.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ])
  return allowed.has(origin) ? origin : null
}

const buildCorsHeaders = (req: Request) => {
  const origin = getCorsOrigin(req)
  if (!origin) return {}

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type,apikey,x-client-info',
    Vary: 'Origin',
  } as Record<string, string>
}

const json = (req: Request, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...buildCorsHeaders(req),
    },
  })

const getBearerToken = (req: Request) => {
  const authHeader = req.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

const isExpired = (expiresAt: string) => new Date(expiresAt).getTime() < Date.now()

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return json(req, 405, { error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json(req, 500, { error: 'Supabase server env is not configured.' })
  }

  const token = getBearerToken(req)
  if (!token) {
    return json(req, 401, { error: 'Missing bearer token.' })
  }

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return json(req, 400, { error: 'Invalid JSON body.' })
  }

  const inviteToken = (body.token ?? '').trim()
  if (!inviteToken) {
    return json(req, 400, { error: 'token is required.' })
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey)
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: userData, error: userError } = await authClient.auth.getUser(token)
  if (userError || !userData?.user?.email) {
    return json(req, 401, { error: 'Invalid user session.' })
  }

  const userId = userData.user.id
  const userEmail = userData.user.email

  const { data: invitation, error: inviteError } = await adminClient
    .from('invitations')
    .select('id, email, status, expires_at')
    .eq('token', inviteToken)
    .maybeSingle()

  if (inviteError || !invitation) {
    return json(req, 200, { status: 'invalid' satisfies AcceptInvitationResult })
  }

  if (invitation.status !== 'pending') {
    return json(req, 200, { status: 'already-used' satisfies AcceptInvitationResult })
  }

  if (isExpired(invitation.expires_at)) {
    await adminClient.from('invitations').update({ status: 'expired' }).eq('id', invitation.id)
    return json(req, 200, { status: 'expired' satisfies AcceptInvitationResult })
  }

  if (String(invitation.email).toLowerCase() !== userEmail.toLowerCase()) {
    return json(req, 200, { status: 'email-mismatch' satisfies AcceptInvitationResult })
  }

  const acceptedAt = new Date().toISOString()
  const { error: updateError } = await adminClient
    .from('invitations')
    .update({ status: 'accepted', accepted_at: acceptedAt, used_at: acceptedAt })
    .eq('id', invitation.id)

  if (updateError) {
    return json(req, 500, { error: 'Failed to accept invitation.' })
  }

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

  return json(req, 200, { status: 'accepted' satisfies AcceptInvitationResult })
}

