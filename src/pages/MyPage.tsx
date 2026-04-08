import { useEffect, useState } from 'react'

import { useAuth } from '../auth/AuthContext'
import { listCourses, listLessonsByCourse, listProgressByUser } from '../data/lmsRepository'

export const MyPage = () => {
  const { user } = useAuth()
  const [progressRows, setProgressRows] = useState<Array<{ id: string; title: string; progress: number }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setProgressRows([])
        setLoading(false)
        return
      }

      const [courses, progress] = await Promise.all([listCourses(), listProgressByUser(user.id)])
      const rows = await Promise.all(
        courses.map(async (course) => {
          const lessons = (await listLessonsByCourse(course.id)).filter((lesson) => lesson.isPublished)
          if (lessons.length === 0) {
            return { id: course.id, title: course.title, progress: 0 }
          }

          const completed = lessons.filter((lesson) =>
            progress.some((item) => item.lessonId === lesson.id && item.isCompleted),
          ).length

          return {
            id: course.id,
            title: course.title,
            progress: Math.round((completed / lessons.length) * 100),
          }
        }),
      )

      setProgressRows(rows)
      setLoading(false)
    }

    void load()
  }, [user])

  const total = progressRows.length === 0
    ? 0
    : Math.round(progressRows.reduce((sum, row) => sum + row.progress, 0) / progressRows.length)

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
    </section>
  )
}
