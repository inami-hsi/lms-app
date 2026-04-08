import type { Course, Invitation, Lesson, WatchProgress } from '../types/lms'

export const demoCourses: Course[] = [
  {
    id: 'course-1',
    title: '生成AI実践入門',
    description: '業務で使えるプロンプト設計と自動化の基礎を学びます。',
    thumbnailUrl: 'https://images.unsplash.com/photo-1677442135703-1787eea5ce01?auto=format&fit=crop&w=1200&q=80',
    isPublished: true,
  },
  {
    id: 'course-2',
    title: 'SNS導線設計マスター',
    description: 'Instagram・LINE導線の作り方と改善ポイントを解説します。',
    thumbnailUrl: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=1200&q=80',
    isPublished: true,
  },
]

export const demoLessons: Lesson[] = [
  { id: 'lesson-1', courseId: 'course-1', title: 'イントロダクション', youtubeVideoId: 'dQw4w9WgXcQ', order: 1, isPublished: true },
  { id: 'lesson-2', courseId: 'course-1', title: 'プロンプト設計の型', youtubeVideoId: 'M7lc1UVf-VE', order: 2, isPublished: true },
  { id: 'lesson-3', courseId: 'course-2', title: '導線全体設計', youtubeVideoId: 'ysz5S6PUM-U', order: 1, isPublished: true },
]

export const demoProgress: WatchProgress[] = [
  {
    userId: 'demo-learner',
    lessonId: 'lesson-1',
    watchedSeconds: 230,
    totalSeconds: 300,
    isCompleted: false,
    updatedAt: new Date().toISOString(),
  },
]

export const demoInvitations: Invitation[] = [
  {
    id: crypto.randomUUID(),
    email: 'member1@example.com',
    invitedBy: 'demo-admin',
    status: 'pending',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    token: crypto.randomUUID(),
  },
]

export const getLessonsByCourse = (courseId: string) =>
  demoLessons.filter((lesson) => lesson.courseId === courseId && lesson.isPublished).sort((a, b) => a.order - b.order)

export const getCourseProgress = (courseId: string, userId: string) => {
  const lessons = getLessonsByCourse(courseId)
  if (lessons.length === 0) return 0

  const completed = lessons.filter((lesson) => {
    const progress = demoProgress.find((item) => item.lessonId === lesson.id && item.userId === userId)
    return progress?.isCompleted
  }).length

  return Math.round((completed / lessons.length) * 100)
}
