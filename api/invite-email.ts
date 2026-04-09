type InvitePayload = {
  type?: string
  email?: string
  inviteLink?: string
  expiresAt?: string
}

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

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
    'Access-Control-Allow-Headers': 'authorization,content-type,apikey,x-client-info,x-invite-timestamp,x-invite-signature',
    Vary: 'Origin',
  } as Record<string, string>
}

const json = (req: Request, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...buildCorsHeaders(req) },
  })

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const toHex = (buffer: ArrayBuffer) => Buffer.from(buffer).toString('hex')

const verifySignature = async (req: Request, rawBody: string) => {
  const secret = process.env.INVITE_WEBHOOK_SECRET
  if (!secret) return true

  const timestamp = req.headers.get('x-invite-timestamp')
  const signature = req.headers.get('x-invite-signature')
  if (!timestamp || !signature) return false

  const timestampNum = Number(timestamp)
  if (!Number.isFinite(timestampNum) || Math.abs(Date.now() - timestampNum) > MAX_CLOCK_SKEW_MS) {
    return false
  }

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`))
  const expected = toHex(signed)

  return expected === signature
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

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return json(req, 405, { error: 'Method not allowed' })
  }

  const resendApiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.INVITE_FROM_EMAIL ?? 'LMS <onboarding@resend.dev>'
  const timeoutMs = Number(process.env.RESEND_TIMEOUT_MS ?? '10000')
  const retries = Number(process.env.RESEND_RETRIES ?? '2')

  if (!resendApiKey) {
    return json(req, 500, { error: 'RESEND_API_KEY is not set' })
  }

  let payload: InvitePayload
  let rawBody = ''
  try {
    rawBody = await req.text()
    payload = JSON.parse(rawBody) as InvitePayload
  } catch {
    return json(req, 400, { error: 'Invalid JSON body' })
  }

  const verified = await verifySignature(req, rawBody)
  if (!verified) {
    return json(req, 401, { error: 'Invalid webhook signature' })
  }

  if (!payload.email || !payload.inviteLink || !payload.expiresAt) {
    return json(req, 400, { error: 'email, inviteLink and expiresAt are required' })
  }

  const attempts = Math.max(1, retries + 1)
  let lastError = ''

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
          to: payload.email,
          subject: '【LMS】受講招待のお知らせ',
          html: buildHtml(payload.inviteLink, payload.expiresAt),
        }),
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const detail = await response.text()
        throw new Error(`Resend error: ${response.status} ${detail}`)
      }

      const result = await response.json()
      return json(req, 200, { ok: true, attempt: attempt + 1, result })
    } catch (error) {
      clearTimeout(timeout)
      lastError = error instanceof Error ? error.message : 'unknown error'

      if (attempt < attempts - 1) {
        await wait(400 * (attempt + 1))
      }
    }
  }

  return json(req, 502, { error: 'Failed to send email with Resend', detail: lastError, retries: attempts - 1 })
}
