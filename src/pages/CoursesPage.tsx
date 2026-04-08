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
      const loadedCourses = (await listCourses()).filter((course) => course.isPublished)
      setCourses(loadedCourses)

      if (!user) {
        setProgressByCourse({})
        setLoading(false)
        return
      }

      const progress = await listProgressByUser(user.id)
      const progressMap: Record<string, number> = {}

      await Promise.all(
        loadedCourses.map(async (course) => {
          const lessons = (await listLessonsByCourse(course.id)).filter((lesson) => lesson.isPublished)
          if (lessons.length === 0) {
            progressMap[course.id] = 0
            return
          }

          const completed = lessons.filter((lesson) =>
            progress.some((item) => item.lessonId === lesson.id && item.isCompleted),
          ).length
          progressMap[course.id] = Math.round((completed / lessons.length) * 100)
        }),
      )

      setProgressByCourse(progressMap)
      setLoading(false)
    }

    void load()
  }, [user])

  const publishedCourses = useMemo(() => courses.filter((course) => course.isPublished), [courses])

  return (
    <section>
      <h1>コース一覧</h1>
      <p className="muted">受講可能なコースと進捗を確認できます。</p>
      {loading && <p className="muted">読み込み中...</p>}
      <div className="card-grid">
        {publishedCourses.map((course) => {
            const progress = progressByCourse[course.id] ?? 0
            return (
              <article key={course.id} className="card">
                <img src={course.thumbnailUrl} alt={course.title} className="card-image" />
                <h2>{course.title}</h2>
                <p>{course.description}</p>
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
