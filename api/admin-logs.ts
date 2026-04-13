/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

type LogType = 'email' | 'api'
type SortOrder = 'asc' | 'desc'

type EmailAction = 'create' | 'resend'
type EmailStatus = 'success' | 'failed'
type ApiAction = 'create' | 'resend' | 'revoke'
type AllowedFilter = 'allowed' | 'blocked'

const getCorsOrigin = (req: any) => {
  const origin =
    typeof req?.headers?.get === 'function' ? req.headers.get('origin') : req?.headers?.origin || req?.headers?.Origin
  if (!origin || typeof origin !== 'string') return null

  // Lock down to known frontends.
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

const getBearerToken = (req: any) => {
  const authHeader =
    typeof req?.headers?.get === 'function'
      ? req.headers.get('authorization')
      : req?.headers?.authorization || req?.headers?.Authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  return authHeader.slice(7)
}

const parseLimit = (value: string | null, fallback: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(200, Math.floor(parsed)))
}

const parseHours = (value: string | null) => {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.floor(parsed)
}

const parseSearchTerm = (value: string | null) => {
  if (!value) return null
  const normalized = value.trim()
  if (!normalized) return null
  return normalized.slice(0, 120)
}

type ParsedCursor = {
  createdAt: string
  id: string | null
}

const toBase64 = (value: string) => {
  if (typeof btoa === 'function') {
    return btoa(value)
  }
  return Buffer.from(value, 'utf-8').toString('base64')
}

const parseSortOrder = (value: string | null): SortOrder => {
  if (value === 'asc') return 'asc'
  return 'desc'
}

const fromBase64 = (value: string) => {
  if (typeof atob === 'function') {
    return atob(value)
  }
  return Buffer.from(value, 'base64').toString('utf-8')
}

const encodeCursor = (createdAt: string, id: string) => {
  return toBase64(JSON.stringify({ createdAt, id }))
}

/**
 * Cursor is a base64 JSON string: {"createdAt":"<ISO8601>","id":"<string>"}
 * - createdAt: ISO8601 timestamp (UTC)
 * - id: log row id (string)
 * Fallback: accepts raw ISO8601 string (id will be null)
 *
 * Pagination rule:
 * - When sort=desc (default): fetch rows older than cursor (created_at < cursor.createdAt)
 * - When sort=asc: fetch rows newer than cursor (created_at > cursor.createdAt)
 * - When created_at is equal, compare by id with the same direction.
 */
const parseCursor = (value: string | null) => {
  if (!value) return null

  try {
    const decoded = fromBase64(value)
    const parsed = JSON.parse(decoded) as { createdAt?: unknown; id?: unknown }
    if (typeof parsed.createdAt !== 'string') return null
    const millis = Date.parse(parsed.createdAt)
    if (Number.isNaN(millis)) return null

    return {
      createdAt: new Date(millis).toISOString(),
      id: typeof parsed.id === 'string' ? parsed.id : null,
    } as ParsedCursor
  } catch {
    const millis = Date.parse(value)
    if (Number.isNaN(millis)) return null
    return { createdAt: new Date(millis).toISOString(), id: null } as ParsedCursor
  }
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

  return { ok: true as const, adminClient }
}

const toRequestUrl = (req: any) => {
  if (typeof req?.url !== 'string') return new URL('http://localhost')
  const base =
    typeof req?.headers?.get === 'function'
      ? req.headers.get('x-forwarded-host') || req.headers.get('host')
      : req?.headers?.['x-forwarded-host'] || req?.headers?.host
  const protocol =
    typeof req?.headers?.get === 'function'
      ? req.headers.get('x-forwarded-proto') || 'https'
      : req?.headers?.['x-forwarded-proto'] || 'https'
  const origin = base ? `${protocol}://${base}` : 'http://localhost'
  return new URL(req.url, origin)
}

const fetchEmailLogs = async (req: any, adminClient: ReturnType<typeof createClient>, res?: any) => {
  const url = toRequestUrl(req)
  const limit = parseLimit(url.searchParams.get('limit'), 30)
  const hours = parseHours(url.searchParams.get('hours'))
  const cursor = parseCursor(url.searchParams.get('cursor'))
  const action = url.searchParams.get('action') as EmailAction | 'all' | null
  const status = url.searchParams.get('status') as EmailStatus | 'all' | null
  const email = parseSearchTerm(url.searchParams.get('email'))
  const sort = parseSortOrder(url.searchParams.get('sort'))

  let query = adminClient
    .from('invite_email_logs')
    .select('id, invitation_id, email, action, status, error_detail, attempts, created_at', { count: 'exact' })
    .order('created_at', { ascending: sort === 'asc' })
    .order('id', { ascending: sort === 'asc' })
    .limit(limit + 1)

  if (hours) {
    query = query.gte('created_at', new Date(Date.now() - hours * 60 * 60 * 1000).toISOString())
  }

  if (action && action !== 'all') {
    query = query.eq('action', action)
  }

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  if (email) {
    query = query.ilike('email', `%${email}%`)
  }

  if (cursor) {
    if (cursor.id) {
      if (sort === 'asc') {
        query = query.or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`)
      } else {
        query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
      }
    } else if (sort === 'asc') {
      query = query.gt('created_at', cursor.createdAt)
    } else {
      query = query.lt('created_at', cursor.createdAt)
    }
  }

  const { data, error, count } = await query
  if (error) {
    return json(req, 500, { error: 'Failed to fetch invite email logs.' }, res)
  }

  const rows = data ?? []
  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows
  const last = hasMore ? sliced[sliced.length - 1] : null
  const nextCursor = last ? encodeCursor(last.created_at, last.id) : null

  return json(req, 200, { emailLogs: sliced, nextCursor, hasMore, totalCount: count ?? null }, res)
}

const fetchApiLogs = async (req: any, adminClient: ReturnType<typeof createClient>, res?: any) => {
  const url = toRequestUrl(req)
  const limit = parseLimit(url.searchParams.get('limit'), 30)
  const hours = parseHours(url.searchParams.get('hours'))
  const cursor = parseCursor(url.searchParams.get('cursor'))
  const action = url.searchParams.get('action') as ApiAction | 'all' | null
  const allowed = url.searchParams.get('allowed') as AllowedFilter | 'all' | null
  const triggeredBy = parseSearchTerm(url.searchParams.get('triggeredBy'))
  const sourceIp = parseSearchTerm(url.searchParams.get('sourceIp'))
  const sort = parseSortOrder(url.searchParams.get('sort'))

  let query = adminClient
    .from('invite_api_request_logs')
    .select('id, triggered_by, source_ip, action, allowed, reason, created_at', { count: 'exact' })
    .order('created_at', { ascending: sort === 'asc' })
    .order('id', { ascending: sort === 'asc' })
    .limit(limit + 1)

  if (hours) {
    query = query.gte('created_at', new Date(Date.now() - hours * 60 * 60 * 1000).toISOString())
  }

  if (action && action !== 'all') {
    query = query.eq('action', action)
  }

  if (allowed === 'allowed') {
    query = query.eq('allowed', true)
  }

  if (allowed === 'blocked') {
    query = query.eq('allowed', false)
  }

  if (triggeredBy) {
    query = query.ilike('triggered_by', `%${triggeredBy}%`)
  }

  if (sourceIp) {
    query = query.ilike('source_ip', `%${sourceIp}%`)
  }

  if (cursor) {
    if (cursor.id) {
      if (sort === 'asc') {
        query = query.or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`)
      } else {
        query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
      }
    } else if (sort === 'asc') {
      query = query.gt('created_at', cursor.createdAt)
    } else {
      query = query.lt('created_at', cursor.createdAt)
    }
  }

  const { data, error, count } = await query
  if (error) {
    return json(req, 500, { error: 'Failed to fetch invite API logs.' }, res)
  }

  const rows = data ?? []
  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows
  const last = hasMore ? sliced[sliced.length - 1] : null
  const nextCursor = last ? encodeCursor(last.created_at, last.id) : null

  return json(req, 200, { apiLogs: sliced, nextCursor, hasMore, totalCount: count ?? null }, res)
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

  if (req.method !== 'GET') {
    return json(req, 405, { error: 'Method not allowed' }, res)
  }

  const authResult = await ensureAdmin(req)
  if (!authResult.ok) {
    return json(req, authResult.status, { error: authResult.error }, res)
  }

  const type = (toRequestUrl(req).searchParams.get('type') ?? 'email') as LogType
  if (type === 'email') {
    return fetchEmailLogs(req, authResult.adminClient, res)
  }

  if (type === 'api') {
    return fetchApiLogs(req, authResult.adminClient, res)
  }

  return json(req, 400, { error: 'Unsupported log type.' }, res)
}
