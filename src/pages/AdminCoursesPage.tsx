import { useEffect, useState } from 'react'

import { createCourse, listCourses } from '../data/lmsRepository'
import type { Course } from '../types/lms'

export const AdminCoursesPage = () => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [courses, setCourses] = useState<Course[]>([])

  useEffect(() => {
    const load = async () => {
      setCourses(await listCourses())
    }

    void load()
  }, [])

  const handleCreate = async () => {
    if (!title.trim()) return
    const created = await createCourse({
      title: title.trim(),
      description: description.trim(),
    })
    setCourses((current) => [created, ...current])
    setTitle('')
    setDescription('')
  }

  return (
    <section>
      <h1>コース管理</h1>
      <p className="muted">コースの作成・公開状態の確認ができます。</p>

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
            <span className={`badge ${course.isPublished ? 'success' : 'warning'}`}>
              {course.isPublished ? '公開中' : '下書き'}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
