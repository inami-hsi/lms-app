import { Link, Navigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'

import { useAuth } from '../auth/AuthContext'
import { listCourses, listLessonsByCourse, listProgressByUser } from '../data/lmsRepository'
import type { Course, Lesson, WatchProgress } from '../types/lms'

export const CourseDetailPage = () => {
  const { id } = useParams()
  const { user } = useAuth()
  const [course, setCourse] = useState<Course | null>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [progress, setProgress] = useState<WatchProgress[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      if (!id) {
        setLoading(false)
        return
      }

      const courses = await listCourses()
      const found =
        courses.find((item) => item.id === id && (user?.role === 'admin' || item.isPublished)) ?? null
      setCourse(found)

      if (!found) {
        setLoading(false)
        return
      }

      const loadedLessons = await listLessonsByCourse(found.id)
      setLessons(user?.role === 'admin' ? loadedLessons : loadedLessons.filter((lesson) => lesson.isPublished))

      if (user) {
        setProgress(await listProgressByUser(user.id))
      }

      setLoading(false)
    }

    void load()
  }, [id, user])

  if (loading) {
    return <section><p className="muted">読み込み中...</p></section>
  }

  if (!course) {
    return <Navigate to="/" replace />
  }

  return (
    <section>
      <h1>{course.title}</h1>
      <p className="muted">{course.description}</p>
      <div className="table-like">
        {lessons.map((lesson) => {
          const completed = user
            ? progress.some((item) => item.lessonId === lesson.id && item.userId === user.id && item.isCompleted)
            : false

          return (
            <div key={lesson.id} className="row">
              <div>
                <h3>{lesson.order}. {lesson.title}</h3>
                {user?.role === 'admin' && (
                  <span className={`badge ${lesson.isPublished ? 'success' : 'warning'}`}>
                    {lesson.isPublished ? '公開中' : '下書き'}
                  </span>
                )}
                <span className={`badge ${completed ? 'success' : 'warning'}`}>
                  {completed ? '完了' : '未完了'}
                </span>
              </div>
              <Link to={`/watch/${lesson.id}`} className="button secondary">
                視聴する
              </Link>
            </div>
          )
        })}
      </div>
    </section>
  )
}
