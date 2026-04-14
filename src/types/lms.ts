export type UserRole = 'admin' | 'learner'

export type AuthUser = {
  id: string
  email: string
  name: string
  role: UserRole
}

export type Lesson = {
  id: string
  courseId: string
  title: string
  youtubeVideoId: string
  order: number
  isPublished: boolean
}

export type Course = {
  id: string
  title: string
  description: string
  thumbnailUrl: string
  isPublished: boolean
}

export type WatchProgress = {
  userId: string
  lessonId: string
  watchedSeconds: number
  totalSeconds: number
  isCompleted: boolean
  updatedAt: string
}

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export type Invitation = {
  id: string
  email: string
  invitedBy: string
  status: InvitationStatus
  expiresAt: string
  token?: string
  inviteLink?: string
  notificationError?: string
}

export type InviteEmailLogStatus = 'success' | 'failed'

export type InviteEmailLog = {
  id: string
  invitationId?: string
  email: string
  action: 'create' | 'resend'
  status: InviteEmailLogStatus
  errorDetail?: string
  attempts: number
  createdAt: string
}

export type InviteApiRequestLog = {
  id: string
  triggeredBy?: string
  sourceIp?: string
  action: 'create' | 'resend' | 'revoke' | 'accept'
  allowed: boolean
  reason?: string
  createdAt: string
}
