/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

type LessonRow = {
  id: string
  title: string
  course_id: string
  order: number
}

type CourseRow = {
  id: string
  title: string
}

type ProgressRow = {
  lesson_id: string
  is_completed: boolean
  updated_at: string
}

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex')

const toRequestUrl = (req: any) => {
  if (typeof req?.url === 'string' && /^https?:\/\//.test(req.url)) {
    return new URL(req.url)
  }

  const headers = req?.headers ?? {}
  const get = typeof headers?.get === 'function' ? (name: string) => headers.get(name) : (name: string) => headers?.[name]
  const proto = get('x-forwarded-proto') ?? get('X-Forwarded-Proto') ?? 'https'
  const host = get('x-forwarded-host') ?? get('X-Forwarded-Host') ?? get('host') ?? get('Host') ?? 'localhost'
  const path = typeof req?.url === 'string' ? req.url : '/'
  return new URL(`${proto}://${host}${path}`)
}

const parseToken = (value: string | null) => {
  if (!value) return null
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > 120) return null
  return normalized
}

const formatUtc = (date: Date) => {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0')
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = date.getUTCDate().toString().padStart(2, '0')
  const hh = date.getUTCHours().toString().padStart(2, '0')
  const mi = date.getUTCMinutes().toString().padStart(2, '0')
  const ss = date.getUTCSeconds().toString().padStart(2, '0')
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`
}

const escapeText = (value: string) => {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')
}

const addDaysUtcMidnight = (date: Date, days: number) => {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days, 0, 0, 0))
}

const atUtc = (date: Date, hour: number, minute = 0) => {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute, 0))
}

const maxDate = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b)

export default async function handler(req: any, res?: any) {
  if (req.method !== 'GET') {
    if (res && typeof res.status === 'function') {
      res.status(405)
      return res.end('Method not allowed')
    }
    return new Response('Method not allowed', { status: 405 })
  }

  const url = toRequestUrl(req)
  const token = parseToken(url.searchParams.get('token'))
  if (!token) {
    if (res && typeof res.status === 'function') {
      res.status(400)
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      return res.end('Missing token')
    }
    return new Response('Missing token', { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    if (res && typeof res.status === 'function') {
      res.status(500)
      res.setHeader('Cache-Control', 'no-store')
      return res.end('Server env is not configured')
    }
    return new Response('Server env is not configured', { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const tokenHash = sha256Hex(token)

  const { data: tokenRow } = await adminClient
    .from('calendar_feed_tokens')
    .select('feed_id, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (!tokenRow || tokenRow.revoked_at) {
    // Return empty calendar rather than leaking existence.
    const empty = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//lms-app//calendar//EN',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
    if (res && typeof res.status === 'function') {
      res.status(200)
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
      return res.end(empty)
    }
    return new Response(empty, { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } })
  }

  const { data: feed } = await adminClient
    .from('calendar_feeds')
    .select('user_id, start_date, cadence_days, deadline_days')
    .eq('id', tokenRow.feed_id)
    .maybeSingle()

  if (!feed?.user_id) {
    const empty = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//lms-app//calendar//EN',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
    if (res && typeof res.status === 'function') {
      res.status(200)
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
      return res.end(empty)
    }
    return new Response(empty, { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } })
  }

  const userId = feed.user_id as string
  const cadenceDays = Math.max(1, Math.min(30, Number(feed.cadence_days ?? 1)))
  const deadlineDays = Math.max(1, Math.min(90, Number(feed.deadline_days ?? 7)))

  const startDateStr = typeof feed.start_date === 'string' ? feed.start_date : null
  const startDate = startDateStr ? new Date(`${startDateStr}T00:00:00.000Z`) : new Date()
  const startAt = atUtc(startDate, 0, 0) // 09:00 JST

  const { data: profile } = await adminClient.from('profiles').select('role, is_active').eq('id', userId).maybeSingle()
  const isActive = profile?.is_active !== false
  const isAdmin = profile?.role === 'admin'

  // Only include published lessons for the calendar feed.
  let courseQuery = adminClient.from('courses').select('id, title, is_published')
  if (!isAdmin) courseQuery = courseQuery.eq('is_published', true)
  const { data: coursesRaw } = await courseQuery
  const courses = (coursesRaw ?? []).filter((c: any) => c && c.is_published !== false).map((c: any) => ({ id: c.id as string, title: c.title as string })) as CourseRow[]

  const courseIds = courses.map((c) => c.id)
  let lessons: LessonRow[] = []
  if (courseIds.length > 0) {
    let lessonQuery = adminClient.from('lessons').select('id, title, course_id, order, is_published').in('course_id', courseIds)
    if (!isAdmin) lessonQuery = lessonQuery.eq('is_published', true)
    const { data: lessonRaw } = await lessonQuery
    lessons = (lessonRaw ?? [])
      .filter((l: any) => l && l.is_published !== false)
      .map((l: any) => ({ id: l.id as string, title: l.title as string, course_id: l.course_id as string, order: Number(l.order ?? 0) })) as LessonRow[]
  }

  const courseTitleById = new Map(courses.map((c) => [c.id, c.title]))
  lessons.sort((a, b) => {
    const ca = courseTitleById.get(a.course_id) ?? ''
    const cb = courseTitleById.get(b.course_id) ?? ''
    if (ca !== cb) return ca.localeCompare(cb)
    return a.order - b.order
  })

  const { data: progressRaw } = await adminClient
    .from('watch_progress')
    .select('lesson_id, is_completed, updated_at')
    .eq('user_id', userId)

  const completed = new Set<string>()
  let latestCompletedAt: Date | null = null
  ;(progressRaw ?? []).forEach((row: any) => {
    const pr = row as ProgressRow
    if (pr.is_completed) {
      completed.add(pr.lesson_id)
      const d = new Date(pr.updated_at)
      if (!Number.isNaN(d.getTime())) {
        latestCompletedAt = latestCompletedAt ? maxDate(latestCompletedAt, d) : d
      }
    }
  })

  let anchor = startAt
  if (latestCompletedAt) {
    const completedDay = atUtc(latestCompletedAt, 0, 0)
    anchor = maxDate(anchor, addDaysUtcMidnight(completedDay, 1))
  }

  const now = new Date()
  if (!isActive) {
    // Still return an empty calendar to avoid leaking account state.
    const empty = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//lms-app//calendar//EN',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
    if (res && typeof res.status === 'function') {
      res.status(200)
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
      return res.end(empty)
    }
    return new Response(empty, { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } })
  }

  const baseAppUrl = (process.env.APP_BASE_URL ?? 'https://lms.ai-nagoya.com').replace(/\/+$/, '')

  const lines: string[] = []
  lines.push('BEGIN:VCALENDAR')
  lines.push('VERSION:2.0')
  lines.push('PRODID:-//lms-app//calendar//EN')
  lines.push('CALSCALE:GREGORIAN')
  lines.push('METHOD:PUBLISH')

  const dtstamp = formatUtc(now)
  let offset = 0
  const maxEvents = 200

  for (const lesson of lessons) {
    if (completed.has(lesson.id)) continue
    const startDay = addDaysUtcMidnight(anchor, offset * cadenceDays)
    const startTime = atUtc(startDay, 0, 0) // 09:00 JST
    const endTime = atUtc(startDay, 0, 30) // 30 mins placeholder
    const deadlineDay = addDaysUtcMidnight(startDay, deadlineDays)
    const deadlineTime = atUtc(deadlineDay, 9, 0) // 18:00 JST

    const courseTitle = courseTitleById.get(lesson.course_id) ?? 'Course'
    const lessonUrl = `${baseAppUrl}/watch/${lesson.id}`

    // Start event
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${escapeText(`lms-${tokenHash.slice(0, 12)}-${lesson.id}-start`)}`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART:${formatUtc(startTime)}`)
    lines.push(`DTEND:${formatUtc(endTime)}`)
    lines.push(`SUMMARY:${escapeText(`学習開始: ${courseTitle} / ${lesson.title}`)}`)
    lines.push(`URL:${escapeText(lessonUrl)}`)
    lines.push(`DESCRIPTION:${escapeText(`Lesson: ${lesson.title}\\nOpen: ${lessonUrl}`)}`)
    lines.push('END:VEVENT')

    // Deadline event
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${escapeText(`lms-${tokenHash.slice(0, 12)}-${lesson.id}-deadline`)}`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART:${formatUtc(deadlineTime)}`)
    lines.push(`DTEND:${formatUtc(new Date(deadlineTime.getTime() + 15 * 60 * 1000))}`)
    lines.push(`SUMMARY:${escapeText(`締切: ${courseTitle} / ${lesson.title}`)}`)
    lines.push(`URL:${escapeText(lessonUrl)}`)
    lines.push(`DESCRIPTION:${escapeText(`Deadline for: ${lesson.title}\\nOpen: ${lessonUrl}`)}`)
    lines.push('END:VEVENT')

    offset += 1
    if (offset * 2 >= maxEvents) break
  }

  lines.push('END:VCALENDAR')
  lines.push('')
  const ics = lines.join('\r\n')

  if (res && typeof res.status === 'function') {
    res.status(200)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', 'inline; filename="lms.ics"')
    return res.end(ics)
  }

  return new Response(ics, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="lms.ics"',
    },
  })
}

