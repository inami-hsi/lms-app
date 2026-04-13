import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../auth/AuthContext'
import { listCourses, listLessonsByCourse, listProgressByUser } from '../data/lmsRepository'
import type { Course } from '../types/lms'

export const CoursesPage = () => {
  const { user } = useAuth()
  const [courses, setCourses] = useState<Course[]>([])
  const [progressByCourse, setProgressByCourse] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const allCourses = await listCourses()
      const visibleCourses = user?.role === 'admin' ? allCourses : allCourses.filter((course) => course.isPublished)
      setCourses(visibleCourses)

      if (!user) {
        setProgressByCourse({})
        setLoading(false)
        return
      }

      const progress = await listProgressByUser(user.id)
      const progressMap: Record<string, number> = {}

      await Promise.all(
        visibleCourses.map(async (course) => {
          const lessons = await listLessonsByCourse(course.id)
          const visibleLessons = user.role === 'admin' ? lessons : lessons.filter((lesson) => lesson.isPublished)
          if (visibleLessons.length === 0) {
            progressMap[course.id] = 0
            return
          }

          const fractions = visibleLessons.map((lesson) => {
            const record = progress.find((item) => item.lessonId === lesson.id)
            if (!record) return 0
            if (record.isCompleted) return 1
            if (record.totalSeconds <= 0) return 0
            return Math.max(0, Math.min(1, record.watchedSeconds / record.totalSeconds))
          })
          progressMap[course.id] = Math.round((fractions.reduce((sum, v) => sum + v, 0) / visibleLessons.length) * 100)
        }),
      )

      setProgressByCourse(progressMap)
      setLoading(false)
    }

    void load()
  }, [user])

  const visibleCourses = useMemo(
    () => (user?.role === 'admin' ? courses : courses.filter((course) => course.isPublished)),
    [courses, user?.role],
  )

  return (
    <section>
      <h1>コース一覧</h1>
      <p className="muted">受講可能なコースと進捗を確認できます。</p>
      {loading && <p className="muted">読み込み中...</p>}
      {!loading && visibleCourses.length === 0 && (
        <div className="empty-state">
          <p className="muted">公開中のコースがありません。</p>
          {user?.role === 'admin' && (
            <p className="muted">
              管理者は <Link to="/admin/courses">コース管理</Link> でコース/レッスンを作成して公開してください。
            </p>
          )}
        </div>
      )}
      <div className="card-grid">
        {visibleCourses.map((course) => {
            const progress = progressByCourse[course.id] ?? 0
            return (
              <article key={course.id} className="card">
                <img src={course.thumbnailUrl} alt={course.title} className="card-image" />
                <h2>{course.title}</h2>
                <p>{course.description}</p>
                {user?.role === 'admin' && (
                  <span className={`badge ${course.isPublished ? 'success' : 'warning'}`}>
                    {course.isPublished ? '公開中' : '下書き'}
                  </span>
                )}
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <p className="muted">進捗: {progress}%</p>
                <Link to={`/courses/${course.id}`} className="button primary">
                  詳細を見る
                </Link>
              </article>
            )
          })}
      </div>
    </section>
  )
}
