import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../auth/AuthContext'
import { issueCalendarFeed, listCourses, listLessonsByCourse, listProgressByUser } from '../data/lmsRepository'

export const MyPage = () => {
  const { user } = useAuth()
  const [progressRows, setProgressRows] = useState<Array<{ id: string; title: string; progress: number }>>([])
  const [loading, setLoading] = useState(true)
  const [calendarFeedUrl, setCalendarFeedUrl] = useState<string | null>(null)
  const [calendarStartDate, setCalendarStartDate] = useState<string>('')
  const [calendarCadenceDays, setCalendarCadenceDays] = useState(1)
  const [calendarDeadlineDays, setCalendarDeadlineDays] = useState(7)
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null)
  const [isIssuingCalendar, setIsIssuingCalendar] = useState(false)

  const todayIsoDate = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const CALENDAR_STORAGE_KEY = 'lms.calendarFeedUrl'

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setProgressRows([])
        setLoading(false)
        return
      }

      const [courses, progress] = await Promise.all([listCourses(), listProgressByUser(user.id)])
      const visibleCourses = user.role === 'admin' ? courses : courses.filter((course) => course.isPublished)
      const rows = await Promise.all(
        visibleCourses.map(async (course) => {
          const lessons = await listLessonsByCourse(course.id)
          const visibleLessons = user.role === 'admin' ? lessons : lessons.filter((lesson) => lesson.isPublished)

          if (visibleLessons.length === 0) {
            return { id: course.id, title: course.title, progress: 0 }
          }

          const fractions = visibleLessons.map((lesson) => {
            const record = progress.find((item) => item.lessonId === lesson.id)
            if (!record) return 0
            if (record.isCompleted) return 1
            if (record.totalSeconds <= 0) return 0
            return Math.max(0, Math.min(1, record.watchedSeconds / record.totalSeconds))
          })

          return {
            id: course.id,
            title: course.title,
            progress: Math.round((fractions.reduce((sum, v) => sum + v, 0) / visibleLessons.length) * 100),
          }
        }),
      )

      setProgressRows(rows)
      setLoading(false)
    }

    void load()
  }, [user])

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(CALENDAR_STORAGE_KEY) : null
    if (saved) setCalendarFeedUrl(saved)
    setCalendarStartDate(todayIsoDate)
  }, [todayIsoDate])

  const total = progressRows.length === 0
    ? 0
    : Math.round(progressRows.reduce((sum, row) => sum + row.progress, 0) / progressRows.length)

  const handleIssueCalendar = async () => {
    setCalendarMessage(null)
    setIsIssuingCalendar(true)
    try {
      const result = await issueCalendarFeed({
        startDate: calendarStartDate || undefined,
        cadenceDays: calendarCadenceDays,
        deadlineDays: calendarDeadlineDays,
      })
      setCalendarFeedUrl(result.feedUrl)
      window.localStorage.setItem(CALENDAR_STORAGE_KEY, result.feedUrl)
      setCalendarMessage('カレンダー購読URLを発行しました。GoogleカレンダーにURLで追加してください。')
    } catch (error) {
      setCalendarMessage(error instanceof Error ? error.message : 'カレンダー連携に失敗しました。')
    } finally {
      setIsIssuingCalendar(false)
    }
  }

  const handleCopyCalendarUrl = async () => {
    if (!calendarFeedUrl) return
    try {
      await navigator.clipboard.writeText(calendarFeedUrl)
      setCalendarMessage('購読URLをコピーしました。')
    } catch {
      setCalendarMessage('コピーに失敗しました。手動でURLを選択してコピーしてください。')
    }
  }

  return (
    <section>
      <h1>マイページ</h1>
      <p className="muted">学習進捗のサマリーを確認できます。</p>
      {loading && <p className="muted">読み込み中...</p>}

      <div className="stat-grid">
        <article className="stat-card">
          <h2>全体進捗</h2>
          <p className="stat-value">{total}%</p>
        </article>
        <article className="stat-card">
          <h2>受講コース数</h2>
          <p className="stat-value">{progressRows.length}</p>
        </article>
      </div>

      <div className="table-like">
        {progressRows.map((row) => (
          <div key={row.id} className="row">
            <h3>{row.title}</h3>
            <span className="badge neutral">{row.progress}%</span>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>Googleカレンダー連携（購読URL）</h2>
        <p className="muted">
          受講の開始予定と締切を、あなた専用の購読カレンダーとして発行します（URLは第三者に共有しないでください）。
        </p>

        <div className="inline-actions" style={{ alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">開始日</span>
            <input type="date" value={calendarStartDate} onChange={(e) => setCalendarStartDate(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">間隔（日）</span>
            <input
              type="number"
              min={1}
              max={30}
              value={calendarCadenceDays}
              onChange={(e) => setCalendarCadenceDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">締切（日後）</span>
            <input
              type="number"
              min={1}
              max={90}
              value={calendarDeadlineDays}
              onChange={(e) => setCalendarDeadlineDays(Math.max(1, Math.min(90, Number(e.target.value) || 7)))}
            />
          </label>
          <button type="button" className="button primary" onClick={() => void handleIssueCalendar()} disabled={isIssuingCalendar}>
            {isIssuingCalendar ? '発行中...' : '購読URLを発行'}
          </button>
        </div>

        {calendarMessage && <p className="muted" style={{ marginTop: 8 }}>{calendarMessage}</p>}

        {calendarFeedUrl && (
          <div style={{ marginTop: 12 }}>
            <p className="muted">購読URL（Googleカレンダー → 他のカレンダー → URLで追加）</p>
            <div className="inline-actions">
              <input type="text" readOnly value={calendarFeedUrl} style={{ flex: 1, minWidth: 240 }} />
              <button type="button" className="button" onClick={() => void handleCopyCalendarUrl()}>
                コピー
              </button>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              Googleカレンダー側の更新反映には時間がかかる場合があります。
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
