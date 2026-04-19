import { useEffect, useMemo, useState } from 'react'

import { createCourse, createLesson, listCourses, listLessonsByCourse, setCoursePublished, setLessonPublished } from '../data/lmsRepository'
import type { Course, Lesson } from '../types/lms'

export const AdminCoursesPage = () => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [courses, setCourses] = useState<Course[]>([])
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null)
  const [lessonsByCourse, setLessonsByCourse] = useState<Record<string, Lesson[]>>({})
  const [lessonTitle, setLessonTitle] = useState('')
  const [lessonYoutubeId, setLessonYoutubeId] = useState('')
  const [lessonOrder, setLessonOrder] = useState(1)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const load = async () => {
      setCourses(await listCourses())
    }

    void load()
  }, [])

  const expandedLessons = useMemo(() => {
    if (!expandedCourseId) return []
    return lessonsByCourse[expandedCourseId] ?? []
  }, [expandedCourseId, lessonsByCourse])

  const handleCreate = async () => {
    if (!title.trim()) return
    try {
      const created = await createCourse({
        title: title.trim(),
        description: description.trim(),
      })
      setCourses((current) => [created, ...current])
      setTitle('')
      setDescription('')
      setMessage('コースを追加しました（下書き）。公開するには「公開する」を押してください。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'コースの追加に失敗しました。')
    }
  }

  const toggleCoursePublished = async (course: Course) => {
    try {
      const updated = await setCoursePublished(course.id, !course.isPublished)
      setCourses((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setMessage(updated.isPublished ? 'コースを公開しました。' : 'コースを下書きに戻しました。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'コースの更新に失敗しました。')
    }
  }

  const openLessons = async (courseId: string) => {
    if (expandedCourseId === courseId) {
      setExpandedCourseId(null)
      return
    }

    try {
      setExpandedCourseId(courseId)
      if (!lessonsByCourse[courseId]) {
        const lessons = await listLessonsByCourse(courseId)
        setLessonsByCourse((current) => ({ ...current, [courseId]: lessons }))
        const nextOrder = lessons.length > 0 ? Math.max(...lessons.map((l) => l.order)) + 1 : 1
        setLessonOrder(nextOrder)
      }
      setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'レッスンの取得に失敗しました。')
    }
  }

  const handleCreateLesson = async () => {
    if (!expandedCourseId) return

    try {
      const created = await createLesson({
        courseId: expandedCourseId,
        title: lessonTitle,
        youtubeVideoId: lessonYoutubeId,
        order: lessonOrder,
      })

      setLessonsByCourse((current) => ({
        ...current,
        [expandedCourseId]: [...(current[expandedCourseId] ?? []), created].sort((a, b) => a.order - b.order),
      }))
      setLessonTitle('')
      setLessonYoutubeId('')
      setLessonOrder((current) => current + 1)
      setMessage('レッスンを追加しました（下書き）。公開するには「公開する」を押してください。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'レッスンの追加に失敗しました。')
    }
  }

  const toggleLessonPublished = async (lesson: Lesson) => {
    try {
      const updated = await setLessonPublished(lesson.id, !lesson.isPublished)
      setLessonsByCourse((current) => {
        const list = current[updated.courseId] ?? []
        return {
          ...current,
          [updated.courseId]: list.map((item) => (item.id === updated.id ? updated : item)).sort((a, b) => a.order - b.order),
        }
      })
      setMessage(updated.isPublished ? 'レッスンを公開しました。' : 'レッスンを下書きに戻しました。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'レッスンの更新に失敗しました。')
    }
  }

  return (
    <section>
      <h1>コース管理</h1>
      <p className="muted">コースの作成・公開状態の確認ができます。</p>
      {message && <p className="alert success">{message}</p>}

      <div className="form-grid">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="コース名" />
        <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="説明" />
        <button type="button" className="button primary" onClick={() => void handleCreate()}>コースを追加</button>
      </div>

      <div className="table-like">
        {courses.map((course) => (
          <div key={course.id} className="row">
            <div>
              <h3>{course.title}</h3>
              <p className="muted">{course.description}</p>
            </div>
            <div className="row-actions">
              <span className={`badge ${course.isPublished ? 'success' : 'warning'}`}>
                {course.isPublished ? '公開中' : '下書き'}
              </span>
              <button type="button" className="button secondary" onClick={() => void toggleCoursePublished(course)}>
                {course.isPublished ? '下書きに戻す' : '公開する'}
              </button>
              <button type="button" className="button secondary" onClick={() => void openLessons(course.id)}>
                {expandedCourseId === course.id ? 'レッスンを閉じる' : 'レッスン管理'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {expandedCourseId && (
        <section>
          <h2>レッスン管理</h2>
          <p className="muted">YouTubeの動画IDを入力してレッスンを追加できます。</p>

          <div className="form-grid">
            <input value={lessonTitle} onChange={(event) => setLessonTitle(event.target.value)} placeholder="レッスン名" />
            <input value={lessonYoutubeId} onChange={(event) => setLessonYoutubeId(event.target.value)} placeholder="YouTube動画ID (例: dQw4w9WgXcQ)" />
            <input
              type="number"
              value={lessonOrder}
              onChange={(event) => setLessonOrder(Math.max(1, Number(event.target.value) || 1))}
              placeholder="順番"
            />
            <button type="button" className="button primary" onClick={() => void handleCreateLesson()}>
              レッスンを追加
            </button>
          </div>

          <div className="table-like">
            {expandedLessons.length === 0 && <p className="muted">レッスンがありません。</p>}
            {expandedLessons.map((lesson) => (
              <div key={lesson.id} className="row">
                <div>
                  <h3>{lesson.order}. {lesson.title}</h3>
                  <p className="muted">YouTube ID: {lesson.youtubeVideoId}</p>
                </div>
                <div className="row-actions">
                  <span className={`badge ${lesson.isPublished ? 'success' : 'warning'}`}>
                    {lesson.isPublished ? '公開中' : '下書き'}
                  </span>
                  <button type="button" className="button secondary" onClick={() => void toggleLessonPublished(lesson)}>
                    {lesson.isPublished ? '下書きに戻す' : '公開する'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  )
}
