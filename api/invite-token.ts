import { createClient } from '@supabase/supabase-js'

type InvitationInfo = {
  emailMasked: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  expiresAt: string
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
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
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

const maskEmail = (email: string) => {
  const trimmed = email.trim()
  const at = trimmed.indexOf('@')
  if (at <= 1) return '***'
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  const maskedLocal = `${local[0]}***${local[local.length - 1] ?? ''}`
  return `${maskedLocal}@${domain}`
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(req) })
  }

  if (req.method !== 'GET') {
    return json(req, 405, { error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, 500, { error: 'Supabase server env is not configured.' })
  }

  const url = new URL(req.url)
  const token = (url.searchParams.get('token') ?? '').trim()
  if (!token) {
    return json(req, 400, { error: 'token is required.' })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data, error } = await adminClient
    .from('invitations')
    .select('email, status, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (error || !data) {
    return json(req, 200, { invitation: null })
  }

  const invitation: InvitationInfo = {
    emailMasked: maskEmail(data.email),
    status: data.status,
    expiresAt: data.expires_at,
  }

  return json(req, 200, { invitation })
}

