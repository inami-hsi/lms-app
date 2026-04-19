/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'crypto'

type RequestBody = {
  startDate?: string
  cadenceDays?: number
  deadlineDays?: number
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

const readJsonBody = async (req: any): Promise<RequestBody> => {
  if (typeof req?.json === 'function') return (await req.json()) as RequestBody

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

const getBearerToken = (req: any) => {
  const authHeader = getHeader(req, 'authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex')

const parseIsoDate = (value: unknown) => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  return normalized
}

const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
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

  const authClient = createClient(supabaseUrl, supabaseAnonKey)
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: userData, error: userError } = await authClient.auth.getUser(token)
  if (userError || !userData?.user?.id) {
    return json(req, 401, { error: 'Invalid user session.' }, res)
  }

  const userId = userData.user.id
  const startDate = parseIsoDate(body.startDate)
  const cadenceDays = clampInt(body.cadenceDays, 1, 1, 30)
  const deadlineDays = clampInt(body.deadlineDays, 7, 1, 90)

  const { data: existingFeed } = await adminClient.from('calendar_feeds').select('id, start_date').eq('user_id', userId).maybeSingle()

  const startToStore = startDate ?? (existingFeed?.start_date as string | null) ?? new Date().toISOString().slice(0, 10)

  const { data: feedUpserted, error: feedError } = await adminClient
    .from('calendar_feeds')
    .upsert(
      {
        ...(existingFeed?.id ? { id: existingFeed.id } : {}),
        user_id: userId,
        start_date: startToStore,
        cadence_days: cadenceDays,
        deadline_days: deadlineDays,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select('id')
    .maybeSingle()

  if (feedError || !feedUpserted?.id) {
    return json(req, 500, { error: 'Failed to save calendar feed settings.' }, res)
  }

  const feedId = feedUpserted.id as string
  const rawToken = randomUUID()
  const tokenHash = sha256Hex(rawToken)

  const { error: tokenError } = await adminClient.from('calendar_feed_tokens').insert({
    feed_id: feedId,
    token_hash: tokenHash,
    created_at: new Date().toISOString(),
  })

  if (tokenError) {
    return json(req, 500, { error: 'Failed to issue calendar token.' }, res)
  }

  // Keep at most 5 active tokens per feed (best-effort).
  try {
    const { data: tokens } = await adminClient
      .from('calendar_feed_tokens')
      .select('id')
      .eq('feed_id', feedId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })

    const ids = (tokens ?? []).map((t) => t.id as string)
    const toDelete = ids.slice(5)
    if (toDelete.length > 0) {
      await adminClient.from('calendar_feed_tokens').delete().in('id', toDelete)
    }
  } catch {
    // ignore
  }

  const apiOrigin = toRequestUrl(req).origin
  const trimmedOrigin = String(apiOrigin).replace(/\/+$/, '')
  const feedUrl = `${trimmedOrigin}/api/calendar-feed?token=${rawToken}`

  return json(
    req,
    200,
    {
      feedUrl,
      settings: { startDate: startToStore, cadenceDays, deadlineDays },
    },
    res,
  )
}
