import { createClient } from '@supabase/supabase-js'

type InvitationInfo = {
  emailMasked: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  expiresAt: string
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
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type,apikey,x-client-info',
    Vary: 'Origin',
  } as Record<string, string>
}

const json = (req: any, status: number, body: Record<string, unknown>, res?: any) => {
  const corsHeaders = buildCorsHeaders(req)
  if (res && typeof res.status === 'function') {
    res.status(status)
    res.setHeader('Cache-Control', 'no-store')
    for (const [key, value] of Object.entries(corsHeaders)) res.setHeader(key, value)
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

const maskEmail = (email: string) => {
  const trimmed = email.trim()
  const at = trimmed.indexOf('@')
  if (at <= 1) return '***'
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  const maskedLocal = `${local[0]}***${local[local.length - 1] ?? ''}`
  return `${maskedLocal}@${domain}`
}

export default async function handler(req: any, res?: any) {
  if (req.method === 'OPTIONS') {
    const corsHeaders = buildCorsHeaders(req)
    if (res && typeof res.status === 'function') {
      res.status(204)
      for (const [key, value] of Object.entries(corsHeaders)) res.setHeader(key, value)
      return res.end()
    }
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return json(req, 405, { error: 'Method not allowed' }, res)
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, 500, { error: 'Supabase server env is not configured.' }, res)
  }

  const url = toRequestUrl(req)
  const token = (url.searchParams.get('token') ?? '').trim()
  if (!token) {
    return json(req, 400, { error: 'token is required.' }, res)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data, error } = await adminClient
    .from('invitations')
    .select('email, status, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (error || !data) {
    return json(req, 200, { invitation: null }, res)
  }

  const invitation: InvitationInfo = {
    emailMasked: maskEmail(data.email),
    status: data.status,
    expiresAt: data.expires_at,
  }

  return json(req, 200, { invitation }, res)
}
