import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuth } from '../auth/AuthContext'
import {
  createInvitation,
  expirePendingInvitations,
  getRetryAfterSecFromError,
  listInviteApiRequestLogsPage,
  listInviteEmailLogsPage,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from '../data/lmsRepository'
import type { Invitation, InviteApiRequestLog, InviteEmailLog } from '../types/lms'

const escapeCsv = (value: string | number | boolean | null | undefined) => {
  const stringValue = value == null ? '' : String(value)
  if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

  const downloadCsv = (
    filename: string,
    headers: string[],
    rows: Array<Array<string | number | boolean | null | undefined>>,
    metaRows?: Array<Array<string | number | boolean | null | undefined>>,
  ) => {
    const allRows = metaRows ? [...metaRows, [], headers, ...rows] : [headers, ...rows]
    const content = allRows.map((line) => line.map(escapeCsv).join(',')).join('\n')
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export const AdminUsersPage = () => {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [emailLogs, setEmailLogs] = useState<InviteEmailLog[]>([])
  const [apiLogs, setApiLogs] = useState<InviteApiRequestLog[]>([])
  const [message, setMessage] = useState('')
  const [emailLogRangeHours, setEmailLogRangeHours] = useState(24)
  const [emailLogActionFilter, setEmailLogActionFilter] = useState<'all' | 'create' | 'resend'>('all')
  const [emailLogStatusFilter, setEmailLogStatusFilter] = useState<'all' | 'success' | 'failed'>('all')
  const [emailLogEmailFilter, setEmailLogEmailFilter] = useState('')
  const [debouncedEmailLogEmailFilter, setDebouncedEmailLogEmailFilter] = useState('')
  const [emailLogSort, setEmailLogSort] = useState<'desc' | 'asc'>('desc')
  const [apiLogRangeHours, setApiLogRangeHours] = useState(24)
  const [apiLogActionFilter, setApiLogActionFilter] = useState<'all' | 'create' | 'resend' | 'revoke'>('all')
  const [apiLogAllowedFilter, setApiLogAllowedFilter] = useState<'all' | 'allowed' | 'blocked'>('all')
  const [apiLogTriggeredByFilter, setApiLogTriggeredByFilter] = useState('')
  const [debouncedApiLogTriggeredByFilter, setDebouncedApiLogTriggeredByFilter] = useState('')
  const [apiLogSourceIpFilter, setApiLogSourceIpFilter] = useState('')
  const [debouncedApiLogSourceIpFilter, setDebouncedApiLogSourceIpFilter] = useState('')
  const [apiLogSort, setApiLogSort] = useState<'desc' | 'asc'>('desc')
  const [emailLogsNextCursor, setEmailLogsNextCursor] = useState<string | null>(null)
  const [apiLogsNextCursor, setApiLogsNextCursor] = useState<string | null>(null)
  const [emailLogsHasMore, setEmailLogsHasMore] = useState(false)
  const [apiLogsHasMore, setApiLogsHasMore] = useState(false)
  const [emailLogsTotalCount, setEmailLogsTotalCount] = useState<number | null>(null)
  const [apiLogsTotalCount, setApiLogsTotalCount] = useState<number | null>(null)
  const [isLoadingMoreEmailLogs, setIsLoadingMoreEmailLogs] = useState(false)
  const [isLoadingMoreApiLogs, setIsLoadingMoreApiLogs] = useState(false)
  const [isExportingEmailLogs, setIsExportingEmailLogs] = useState(false)
  const [isExportingApiLogs, setIsExportingApiLogs] = useState(false)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [expandedEmailErrors, setExpandedEmailErrors] = useState<Set<string>>(new Set())
  const [expandedApiReasons, setExpandedApiReasons] = useState<Set<string>>(new Set())
  const [selectedEmailLogId, setSelectedEmailLogId] = useState<string | null>(null)
  const [selectedApiLogId, setSelectedApiLogId] = useState<string | null>(null)
  const [activeLogPanel, setActiveLogPanel] = useState<'email' | 'api' | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastActionLabel, setToastActionLabel] = useState<string | null>(null)
  const [toastAction, setToastAction] = useState<(() => void) | null>(null)
  const [toastVisible, setToastVisible] = useState(false)
  const emailLogRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const apiLogRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const emailDetailRef = useRef<HTMLDivElement | null>(null)
  const apiDetailRef = useRef<HTMLDivElement | null>(null)
  const hasLoadedFilters = useRef(false)

  const FILTER_STORAGE_KEY = 'lms.adminLogs.filters'

  const formatRangeLabel = (hours: number) => {
    if (hours === 0) return '全期間'
    if (hours === 168) return '7日'
    return `${hours}時間`
  }

  const emailActionLabel = (value: 'all' | 'create' | 'resend') => {
    if (value === 'create') return '新規招待'
    if (value === 'resend') return '再送'
    return 'すべて'
  }

  const emailStatusLabel = (value: 'all' | 'success' | 'failed') => {
    if (value === 'success') return '成功'
    if (value === 'failed') return '失敗'
    return 'すべて'
  }

  const apiActionLabel = (value: 'all' | 'create' | 'resend' | 'revoke') => {
    if (value === 'create') return 'CREATE'
    if (value === 'resend') return 'RESEND'
    if (value === 'revoke') return 'REVOKE'
    return 'すべて'
  }

  const apiAllowedLabel = (value: 'all' | 'allowed' | 'blocked') => {
    if (value === 'allowed') return '許可'
    if (value === 'blocked') return 'ブロック'
    return 'すべて'
  }

  const highlightText = (text: string, term: string) => {
    const normalized = term.trim()
    if (!normalized) return text
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${escaped})`, 'ig')
    const parts = text.split(regex)
    if (parts.length === 1) return text

    return parts.map((part, index) => {
      if (regex.test(part)) {
        return (
          <mark key={`${part}-${index}`} className="highlight">
            {part}
          </mark>
        )
      }
      return <span key={`${part}-${index}`}>{part}</span>
    })
  }

  const resetEmailLogFilters = () => {
    setEmailLogRangeHours(24)
    setEmailLogActionFilter('all')
    setEmailLogStatusFilter('all')
    setEmailLogEmailFilter('')
    setEmailLogSort('desc')
  }

  const resetApiLogFilters = () => {
    setApiLogRangeHours(24)
    setApiLogActionFilter('all')
    setApiLogAllowedFilter('all')
    setApiLogTriggeredByFilter('')
    setApiLogSourceIpFilter('')
    setApiLogSort('desc')
  }

  const toggleEmailError = (logId: string) => {
    setExpandedEmailErrors((current) => {
      const next = new Set(current)
      if (next.has(logId)) {
        next.delete(logId)
      } else {
        next.add(logId)
      }
      return next
    })
  }

  const toggleApiReason = (logId: string) => {
    setExpandedApiReasons((current) => {
      const next = new Set(current)
      if (next.has(logId)) {
        next.delete(logId)
      } else {
        next.add(logId)
      }
      return next
    })
  }

  const toggleEmailDetails = (logId: string) => {
    setSelectedEmailLogId((current) => (current === logId ? null : logId))
    setActiveLogPanel('email')
  }

  const toggleApiDetails = (logId: string) => {
    setSelectedApiLogId((current) => (current === logId ? null : logId))
    setActiveLogPanel('api')
  }

  const applyEmailFromLog = (email: string) => {
    setEmailLogEmailFilter(email)
    setEmailLogRangeHours(24)
  }

  const applyTriggeredByFromLog = (value?: string | null) => {
    if (!value) return
    setApiLogTriggeredByFilter(value)
    setApiLogRangeHours(24)
  }

  const applySourceIpFromLog = (value?: string | null) => {
    if (!value) return
    setApiLogSourceIpFilter(value)
    setApiLogRangeHours(24)
  }

  // The API already returns results in the selected order (sort=asc|desc),
  // so do not reverse client-side.
  const emailLogsSorted = emailLogs
  // The API already returns results in the selected order (sort=asc|desc),
  // so do not reverse client-side.
  const apiLogsSorted = apiLogs
  const selectedEmailLog = selectedEmailLogId ? emailLogs.find((log) => log.id === selectedEmailLogId) ?? null : null
  const selectedApiLog = selectedApiLogId ? apiLogs.find((log) => log.id === selectedApiLogId) ?? null : null
  const selectedEmailIndex = selectedEmailLogId
    ? emailLogsSorted.findIndex((log) => log.id === selectedEmailLogId)
    : -1
  const selectedApiIndex = selectedApiLogId ? apiLogsSorted.findIndex((log) => log.id === selectedApiLogId) : -1

  const goToPrevEmailLog = useCallback(() => {
    if (selectedEmailIndex <= 0) return
    setSelectedEmailLogId(emailLogsSorted[selectedEmailIndex - 1].id)
  }, [selectedEmailIndex, emailLogsSorted])

  const goToNextEmailLog = useCallback(() => {
    if (selectedEmailIndex < 0 || selectedEmailIndex >= emailLogsSorted.length - 1) return
    setSelectedEmailLogId(emailLogsSorted[selectedEmailIndex + 1].id)
  }, [selectedEmailIndex, emailLogsSorted])

  const goToPrevApiLog = useCallback(() => {
    if (selectedApiIndex <= 0) return
    setSelectedApiLogId(apiLogsSorted[selectedApiIndex - 1].id)
  }, [selectedApiIndex, apiLogsSorted])

  const goToNextApiLog = useCallback(() => {
    if (selectedApiIndex < 0 || selectedApiIndex >= apiLogsSorted.length - 1) return
    setSelectedApiLogId(apiLogsSorted[selectedApiIndex + 1].id)
  }, [selectedApiIndex, apiLogsSorted])

  const goToEmailByDelta = useCallback(
    (delta: number) => {
      if (selectedEmailIndex < 0) return
      const nextIndex = Math.max(0, Math.min(emailLogsSorted.length - 1, selectedEmailIndex + delta))
      setSelectedEmailLogId(emailLogsSorted[nextIndex]?.id ?? null)
    },
    [selectedEmailIndex, emailLogsSorted],
  )

  const goToApiByDelta = useCallback(
    (delta: number) => {
      if (selectedApiIndex < 0) return
      const nextIndex = Math.max(0, Math.min(apiLogsSorted.length - 1, selectedApiIndex + delta))
      setSelectedApiLogId(apiLogsSorted[nextIndex]?.id ?? null)
    },
    [selectedApiIndex, apiLogsSorted],
  )

  const emailFilterSummary = (() => {
    const summary = [
      `期間: ${formatRangeLabel(emailLogRangeHours)}`,
      `種別: ${emailActionLabel(emailLogActionFilter)}`,
      `結果: ${emailStatusLabel(emailLogStatusFilter)}`,
    ]
    const emailTerm = debouncedEmailLogEmailFilter.trim()
    if (emailTerm) summary.push(`メール: ${emailTerm}`)
    return summary.join(' / ')
  })()

  const apiFilterSummary = (() => {
    const summary = [
      `期間: ${formatRangeLabel(apiLogRangeHours)}`,
      `種別: ${apiActionLabel(apiLogActionFilter)}`,
      `判定: ${apiAllowedLabel(apiLogAllowedFilter)}`,
    ]
    const triggeredBy = debouncedApiLogTriggeredByFilter.trim()
    const sourceIp = debouncedApiLogSourceIpFilter.trim()
    if (triggeredBy) summary.push(`管理者: ${triggeredBy}`)
    if (sourceIp) summary.push(`IP: ${sourceIp}`)
    return summary.join(' / ')
  })()

  const showToast = (message: string, actionLabel?: string, action?: () => void) => {
    setToastMessage(message)
    setToastActionLabel(actionLabel ?? null)
    setToastAction(() => action ?? null)
    setToastVisible(true)
  }

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      showToast(`コピーしました: ${value}`)
    } catch {
      showToast('コピーに失敗しました。')
    }
  }

  useEffect(() => {
    if (!toastVisible) return
    const timer = window.setTimeout(() => {
      setToastVisible(false)
    }, 2200)
    return () => window.clearTimeout(timer)
  }, [toastVisible])

  useEffect(() => {
    if (hasLoadedFilters.current) return
    hasLoadedFilters.current = true
    try {
      const raw = window.localStorage.getItem(FILTER_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<{
        emailRangeHours: number
        emailAction: 'all' | 'create' | 'resend'
        emailStatus: 'all' | 'success' | 'failed'
        emailQuery: string
        emailSort: 'asc' | 'desc'
        apiRangeHours: number
        apiAction: 'all' | 'create' | 'resend' | 'revoke'
        apiAllowed: 'all' | 'allowed' | 'blocked'
        apiTriggeredBy: string
        apiSourceIp: string
        apiSort: 'asc' | 'desc'
      }>

      if (typeof parsed.emailRangeHours === 'number') setEmailLogRangeHours(parsed.emailRangeHours)
      if (parsed.emailAction) setEmailLogActionFilter(parsed.emailAction)
      if (parsed.emailStatus) setEmailLogStatusFilter(parsed.emailStatus)
      if (typeof parsed.emailQuery === 'string') setEmailLogEmailFilter(parsed.emailQuery)
      if (parsed.emailSort) setEmailLogSort(parsed.emailSort)

      if (typeof parsed.apiRangeHours === 'number') setApiLogRangeHours(parsed.apiRangeHours)
      if (parsed.apiAction) setApiLogActionFilter(parsed.apiAction)
      if (parsed.apiAllowed) setApiLogAllowedFilter(parsed.apiAllowed)
      if (typeof parsed.apiTriggeredBy === 'string') setApiLogTriggeredByFilter(parsed.apiTriggeredBy)
      if (typeof parsed.apiSourceIp === 'string') setApiLogSourceIpFilter(parsed.apiSourceIp)
      if (parsed.apiSort) setApiLogSort(parsed.apiSort)
    } catch {
      // Ignore storage errors.
    }
  }, [])

  useEffect(() => {
    if (!hasLoadedFilters.current) return
    const payload = {
      emailRangeHours: emailLogRangeHours,
      emailAction: emailLogActionFilter,
      emailStatus: emailLogStatusFilter,
      emailQuery: emailLogEmailFilter,
      emailSort: emailLogSort,
      apiRangeHours: apiLogRangeHours,
      apiAction: apiLogActionFilter,
      apiAllowed: apiLogAllowedFilter,
      apiTriggeredBy: apiLogTriggeredByFilter,
      apiSourceIp: apiLogSourceIpFilter,
      apiSort: apiLogSort,
    }
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // Ignore storage errors.
    }
  }, [
    emailLogRangeHours,
    emailLogActionFilter,
    emailLogStatusFilter,
    emailLogEmailFilter,
    emailLogSort,
    apiLogRangeHours,
    apiLogActionFilter,
    apiLogAllowedFilter,
    apiLogTriggeredByFilter,
    apiLogSourceIpFilter,
    apiLogSort,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'j', 'k', 'J', 'K'].includes(event.key)) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }

      if (activeLogPanel === 'email' && selectedEmailLogId) {
        event.preventDefault()
        if (event.key === 'ArrowUp' || event.key === 'k' || event.key === 'K') {
          if ((event.key === 'k' || event.key === 'K') && event.shiftKey) {
            goToEmailByDelta(-5)
          } else {
            goToPrevEmailLog()
          }
        } else {
          if ((event.key === 'j' || event.key === 'J') && event.shiftKey) {
            goToEmailByDelta(5)
          } else {
            goToNextEmailLog()
          }
        }
      }

      if (activeLogPanel === 'api' && selectedApiLogId) {
        event.preventDefault()
        if (event.key === 'ArrowUp' || event.key === 'k' || event.key === 'K') {
          if ((event.key === 'k' || event.key === 'K') && event.shiftKey) {
            goToApiByDelta(-5)
          } else {
            goToPrevApiLog()
          }
        } else {
          if ((event.key === 'j' || event.key === 'J') && event.shiftKey) {
            goToApiByDelta(5)
          } else {
            goToNextApiLog()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activeLogPanel,
    selectedEmailLogId,
    selectedApiLogId,
    goToPrevEmailLog,
    goToNextEmailLog,
    goToPrevApiLog,
    goToNextApiLog,
    goToEmailByDelta,
    goToApiByDelta,
  ])

  useEffect(() => {
    if (!selectedEmailLogId) return
    const node = emailLogRefs.current.get(selectedEmailLogId)
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [selectedEmailLogId])

  useEffect(() => {
    if (!selectedApiLogId) return
    const node = apiLogRefs.current.get(selectedApiLogId)
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [selectedApiLogId])

  useEffect(() => {
    if (!selectedEmailLogId) return
    emailDetailRef.current?.focus()
  }, [selectedEmailLogId])

  useEffect(() => {
    if (!selectedApiLogId) return
    apiDetailRef.current?.focus()
  }, [selectedApiLogId])

  const loadLogs = useCallback(async () => {
    setIsLoadingLogs(true)
    try {
      const [nextEmailLogs, nextApiLogs] = await Promise.all([
        listInviteEmailLogsPage({
          limit: 50,
        hours: emailLogRangeHours === 0 ? undefined : emailLogRangeHours,
        action: emailLogActionFilter,
        status: emailLogStatusFilter,
        email: debouncedEmailLogEmailFilter.trim() || undefined,
        sort: emailLogSort,
      }),
      listInviteApiRequestLogsPage({
        limit: 50,
        hours: apiLogRangeHours === 0 ? undefined : apiLogRangeHours,
        action: apiLogActionFilter,
        allowed: apiLogAllowedFilter,
        triggeredBy: debouncedApiLogTriggeredByFilter.trim() || undefined,
        sourceIp: debouncedApiLogSourceIpFilter.trim() || undefined,
        sort: apiLogSort,
      }),
      ])

      setEmailLogs(nextEmailLogs.items)
      setApiLogs(nextApiLogs.items)
      setEmailLogsNextCursor(nextEmailLogs.nextCursor)
      setApiLogsNextCursor(nextApiLogs.nextCursor)
      setEmailLogsHasMore(nextEmailLogs.hasMore)
      setApiLogsHasMore(nextApiLogs.hasMore)
      setEmailLogsTotalCount(nextEmailLogs.totalCount)
      setApiLogsTotalCount(nextApiLogs.totalCount)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'ログの取得に失敗しました。', '再読み込み', () => void loadLogs())
    } finally {
      setIsLoadingLogs(false)
    }
  }, [
    apiLogActionFilter,
    apiLogAllowedFilter,
    apiLogRangeHours,
    apiLogSort,
    debouncedApiLogSourceIpFilter,
    debouncedApiLogTriggeredByFilter,
    debouncedEmailLogEmailFilter,
    emailLogActionFilter,
    emailLogRangeHours,
    emailLogSort,
    emailLogStatusFilter,
  ])

  const loadMoreEmailLogs = async () => {
    if (!emailLogsHasMore || !emailLogsNextCursor || isLoadingMoreEmailLogs) return

    setIsLoadingMoreEmailLogs(true)
    try {
      const nextPage = await listInviteEmailLogsPage({
        limit: 50,
        hours: emailLogRangeHours === 0 ? undefined : emailLogRangeHours,
        cursor: emailLogsNextCursor,
        action: emailLogActionFilter,
        status: emailLogStatusFilter,
        email: debouncedEmailLogEmailFilter.trim() || undefined,
        sort: emailLogSort,
      })
      setEmailLogs((current) => [...current, ...nextPage.items])
      setEmailLogsNextCursor(nextPage.nextCursor)
      setEmailLogsHasMore(nextPage.hasMore)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'ログの追加読み込みに失敗しました。')
    } finally {
      setIsLoadingMoreEmailLogs(false)
    }
  }

  const loadMoreApiLogs = async () => {
    if (!apiLogsHasMore || !apiLogsNextCursor || isLoadingMoreApiLogs) return

    setIsLoadingMoreApiLogs(true)
    try {
      const nextPage = await listInviteApiRequestLogsPage({
        limit: 50,
        hours: apiLogRangeHours === 0 ? undefined : apiLogRangeHours,
        cursor: apiLogsNextCursor,
        action: apiLogActionFilter,
        allowed: apiLogAllowedFilter,
        triggeredBy: debouncedApiLogTriggeredByFilter.trim() || undefined,
        sourceIp: debouncedApiLogSourceIpFilter.trim() || undefined,
        sort: apiLogSort,
      })
      setApiLogs((current) => [...current, ...nextPage.items])
      setApiLogsNextCursor(nextPage.nextCursor)
      setApiLogsHasMore(nextPage.hasMore)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'ログの追加読み込みに失敗しました。')
    } finally {
      setIsLoadingMoreApiLogs(false)
    }
  }

  useEffect(() => {
    if (cooldownSeconds <= 0) return

    const timer = window.setInterval(() => {
      setCooldownSeconds((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [cooldownSeconds])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedEmailLogEmailFilter(emailLogEmailFilter)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [emailLogEmailFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedApiLogTriggeredByFilter(apiLogTriggeredByFilter)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [apiLogTriggeredByFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedApiLogSourceIpFilter(apiLogSourceIpFilter)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [apiLogSourceIpFilter])

  useEffect(() => {
    const load = async () => {
      const nextInvitations = await listInvitations()
      setInvitations(nextInvitations)
    }

    void load()
  }, [])

  useEffect(() => {
    void loadLogs()
  }, [loadLogs])

  const refreshInvitations = async () => {
    const expiredCount = await expirePendingInvitations()
    const nextInvitations = await listInvitations()
    setInvitations(nextInvitations)
    await loadLogs()
    if (expiredCount > 0) {
      setMessage(`期限切れ招待を ${expiredCount} 件更新しました。`)
      return
    }
    setMessage('招待一覧を更新しました。')
  }

  const sendInvite = async () => {
    const trimmed = email.trim()
    if (!trimmed) return

    try {
      const next = await createInvitation({
        email: trimmed,
        invitedBy: user?.id ?? 'demo-admin',
      })

      setInvitations((current) => [next, ...current])
      await loadLogs()
      setEmail('')
      if (next.notificationError) {
        setMessage(`${trimmed} の招待は作成しましたが、通知送信に失敗しました: ${next.notificationError}`)
        return
      }

      setMessage(`${trimmed} へ招待を作成しました。`)
    } catch (error) {
      const retryAfterSec = getRetryAfterSecFromError(error)
      if (retryAfterSec) {
        setCooldownSeconds(retryAfterSec)
      }
      setMessage(error instanceof Error ? error.message : '招待作成に失敗しました。')
    }
  }

  const handleResend = async (invitation: Invitation) => {
    try {
      const updated = await resendInvitation(invitation.id)
      setInvitations((current) => current.map((item) => (item.id === invitation.id ? updated : item)))
      await loadLogs()
      if (updated.notificationError) {
        setMessage(`${invitation.email} の再送処理は完了しましたが、通知送信に失敗しました: ${updated.notificationError}`)
        return
      }

      setMessage(`${invitation.email} へ招待を再送しました。`)
    } catch (error) {
      const retryAfterSec = getRetryAfterSecFromError(error)
      if (retryAfterSec) {
        setCooldownSeconds(retryAfterSec)
      }
      setMessage(error instanceof Error ? error.message : '招待再送に失敗しました。')
    }
  }

  const handleRevoke = async (invitation: Invitation) => {
    try {
      const updated = await revokeInvitation(invitation.id, invitation.email)
      setInvitations((current) => current.map((item) => (item.id === invitation.id ? updated : item)))
      await loadLogs()
      setMessage(`${invitation.email} の招待を取り消しました。`)
    } catch (error) {
      const retryAfterSec = getRetryAfterSecFromError(error)
      if (retryAfterSec) {
        setCooldownSeconds(retryAfterSec)
      }
      setMessage(error instanceof Error ? error.message : '招待取消に失敗しました。')
    }
  }

  const exportEmailLogsCsv = async () => {
    setIsExportingEmailLogs(true)
    try {
      let cursor: string | undefined
      let hasMore = true
      const allLogs: InviteEmailLog[] = []

      while (hasMore) {
        const page = await listInviteEmailLogsPage({
          limit: 200,
          hours: emailLogRangeHours === 0 ? undefined : emailLogRangeHours,
          cursor,
          action: emailLogActionFilter,
          status: emailLogStatusFilter,
          email: debouncedEmailLogEmailFilter.trim() || undefined,
          sort: emailLogSort,
        })

        allLogs.push(...page.items)
        hasMore = page.hasMore && Boolean(page.nextCursor)
        cursor = page.nextCursor ?? undefined
      }

      const now = new Date().toISOString().replace(/[:.]/g, '-')
      const rows = allLogs.map((log) => [
        log.createdAt,
        log.email,
        log.action,
        log.status,
        log.attempts,
        log.errorDetail ?? '',
      ])
      const meta = [
        ['exported_at', new Date().toISOString()],
        ['range_hours', emailLogRangeHours === 0 ? 'all' : String(emailLogRangeHours)],
        ['action', emailLogActionFilter],
        ['status', emailLogStatusFilter],
        ['email', debouncedEmailLogEmailFilter.trim() || ''],
        ['sort', emailLogSort],
      ]
      downloadCsv(
        `invite-email-logs-${now}.csv`,
        ['created_at', 'email', 'action', 'status', 'attempts', 'error_detail'],
        rows,
        meta,
      )
      setMessage(`招待メール送信ログを ${allLogs.length} 件エクスポートしました。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '招待メール送信ログのエクスポートに失敗しました。')
    } finally {
      setIsExportingEmailLogs(false)
    }
  }

  const exportApiLogsCsv = async () => {
    setIsExportingApiLogs(true)
    try {
      let cursor: string | undefined
      let hasMore = true
      const allLogs: InviteApiRequestLog[] = []

      while (hasMore) {
        const page = await listInviteApiRequestLogsPage({
          limit: 200,
          hours: apiLogRangeHours === 0 ? undefined : apiLogRangeHours,
          cursor,
          action: apiLogActionFilter,
          allowed: apiLogAllowedFilter,
          triggeredBy: debouncedApiLogTriggeredByFilter.trim() || undefined,
          sourceIp: debouncedApiLogSourceIpFilter.trim() || undefined,
          sort: apiLogSort,
        })

        allLogs.push(...page.items)
        hasMore = page.hasMore && Boolean(page.nextCursor)
        cursor = page.nextCursor ?? undefined
      }

      const now = new Date().toISOString().replace(/[:.]/g, '-')
      const rows = allLogs.map((log) => [
        log.createdAt,
        log.action,
        log.allowed,
        log.triggeredBy ?? '',
        log.sourceIp ?? '',
        log.reason ?? '',
      ])
      const meta = [
        ['exported_at', new Date().toISOString()],
        ['range_hours', apiLogRangeHours === 0 ? 'all' : String(apiLogRangeHours)],
        ['action', apiLogActionFilter],
        ['allowed', apiLogAllowedFilter],
        ['triggered_by', debouncedApiLogTriggeredByFilter.trim() || ''],
        ['source_ip', debouncedApiLogSourceIpFilter.trim() || ''],
        ['sort', apiLogSort],
      ]
      downloadCsv(
        `invite-api-logs-${now}.csv`,
        ['created_at', 'action', 'allowed', 'triggered_by', 'source_ip', 'reason'],
        rows,
        meta,
      )
      setMessage(`招待APIレート制限ログを ${allLogs.length} 件エクスポートしました。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '招待APIレート制限ログのエクスポートに失敗しました。')
    } finally {
      setIsExportingApiLogs(false)
    }
  }

  return (
    <section>
      <h1>ユーザー管理</h1>
      <p className="muted">招待メール送信とステータス確認のUIです。</p>

      <div className="form-grid">
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          placeholder="招待するメールアドレス"
        />
        <button type="button" className="button primary" onClick={() => void sendInvite()} disabled={cooldownSeconds > 0}>招待を送信</button>
        <button type="button" className="button secondary" onClick={() => void refreshInvitations()}>期限状態を更新</button>
      </div>
      {cooldownSeconds > 0 && <p className="cooldown-hint">レート制限中です。あと {cooldownSeconds} 秒で再試行できます。</p>}
      {message && <p className="alert warning">{message}</p>}
      {isLoadingLogs && <p className="muted">ログを更新中...</p>}
      {toastMessage && (
        <div className={`toast ${toastVisible ? 'show' : ''}`}>
          <span>{toastMessage}</span>
          {toastActionLabel && toastAction && (
            <button
              type="button"
              className="button secondary tiny"
              onClick={() => {
                setToastVisible(false)
                toastAction()
              }}
            >
              {toastActionLabel}
            </button>
          )}
          <button type="button" className="button secondary tiny" onClick={() => setToastVisible(false)}>
            閉じる
          </button>
        </div>
      )}

      <div className="table-like">
        {invitations.map((invitation) => (
          <div key={invitation.id} className="row">
            <div>
              <h3>{invitation.email}</h3>
              <p className="muted">有効期限: {new Date(invitation.expiresAt).toLocaleDateString('ja-JP')}</p>
              {invitation.inviteLink && (
                <p className="invite-link-wrap">
                  <a href={invitation.inviteLink} target="_blank" rel="noreferrer" className="invite-link">
                    招待リンクを開く
                  </a>
                </p>
              )}
              {invitation.notificationError && <p className="invite-notify-error">通知失敗: {invitation.notificationError}</p>}
              <div className="row-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void handleResend(invitation)}
                  disabled={invitation.status === 'revoked' || cooldownSeconds > 0}
                >
                  再送
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void handleRevoke(invitation)}
                  disabled={invitation.status === 'revoked' || cooldownSeconds > 0}
                >
                  取消
                </button>
              </div>
            </div>
            <span className={`badge ${invitation.status === 'accepted' ? 'success' : invitation.status === 'expired' ? 'error' : 'warning'}`}>
              {invitation.status}
            </span>
          </div>
        ))}
      </div>

      <div className="invite-log-panel">
        <div className={`panel-header ${activeLogPanel === 'email' ? 'active' : ''}`}>
          <h2>招待メール送信ログ</h2>
          <button
            type="button"
            className="button secondary tiny"
            onClick={() => setActiveLogPanel('email')}
          >
            このパネルを操作
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => void exportEmailLogsCsv()}
            disabled={emailLogs.length === 0 || isExportingEmailLogs}
          >
            {isExportingEmailLogs ? 'エクスポート中...' : 'CSVエクスポート'}
          </button>
        </div>
        <div className="log-filters">
          <label>
            期間
            <select value={emailLogRangeHours} onChange={(event) => setEmailLogRangeHours(Number(event.target.value))}>
              <option value={6}>6時間</option>
              <option value={24}>24時間</option>
              <option value={168}>7日</option>
              <option value={0}>全期間</option>
            </select>
          </label>
          <label>
            種別
            <select value={emailLogActionFilter} onChange={(event) => setEmailLogActionFilter(event.target.value as 'all' | 'create' | 'resend')}>
              <option value="all">すべて</option>
              <option value="create">新規招待</option>
              <option value="resend">再送</option>
            </select>
          </label>
          <label>
            結果
            <select value={emailLogStatusFilter} onChange={(event) => setEmailLogStatusFilter(event.target.value as 'all' | 'success' | 'failed')}>
              <option value="all">すべて</option>
              <option value="success">成功</option>
              <option value="failed">失敗</option>
            </select>
          </label>
          <label>
            メール検索
            <div className="filter-input-row">
              <input
                type="text"
                value={emailLogEmailFilter}
                onChange={(event) => setEmailLogEmailFilter(event.target.value)}
                placeholder="example@domain.com"
              />
              {emailLogEmailFilter && (
                <button type="button" className="button secondary tiny" onClick={() => setEmailLogEmailFilter('')}>
                  クリア
                </button>
              )}
            </div>
          </label>
          <label>
            並び順
            <select value={emailLogSort} onChange={(event) => setEmailLogSort(event.target.value as 'desc' | 'asc')}>
              <option value="desc">新しい順</option>
              <option value="asc">古い順</option>
            </select>
          </label>
          <button type="button" className="button secondary" onClick={resetEmailLogFilters}>
            フィルタをリセット
          </button>
        </div>
        <p className="muted filter-summary">
          表示件数: {emailLogs.length} 件{emailLogsTotalCount != null ? ` / 合計: ${emailLogsTotalCount} 件` : ''} / {emailFilterSummary}
          {emailLogEmailFilter.trim() && debouncedEmailLogEmailFilter !== emailLogEmailFilter.trim()
            ? '（入力反映中）'
            : ''}
        </p>

        <div className="log-panel-body">
          <div className="log-panel-list">
            {isLoadingLogs && (
              <div className="table-like">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={`email-skeleton-${index}`} className="row invite-log-row skeleton">
                    <div className="skeleton-line wide" />
                    <div className="skeleton-line" />
                  </div>
                ))}
              </div>
            )}
            {emailLogs.length === 0 && (
              <div className="empty-state">
                <p className="muted">条件に一致する送信ログはありません。</p>
                <button type="button" className="button secondary" onClick={resetEmailLogFilters}>
                  フィルタをリセット
                </button>
              </div>
            )}
            {emailLogs.length > 0 && (
              <div className="table-like">
                {emailLogsSorted.map((log) => (
                  <div
                    key={log.id}
                    className={`row invite-log-row ${selectedEmailLogId === log.id ? 'selected' : ''}`}
                    ref={(node) => {
                      emailLogRefs.current.set(log.id, node)
                    }}
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('button,summary,a')) return
                      toggleEmailDetails(log.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        toggleEmailDetails(log.id)
                      }
                    }}
                  >
                    <div>
                      <h3>
                        {highlightText(log.email, debouncedEmailLogEmailFilter)}
                        <button type="button" className="button secondary tiny inline" onClick={() => applyEmailFromLog(log.email)}>
                          このメールで絞る
                        </button>
                      </h3>
                      <p className="muted">
                        {log.action === 'create' ? '新規招待' : '再送'} / {new Date(log.createdAt).toLocaleString('ja-JP')} / 試行 {log.attempts} 回
                      </p>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => toggleEmailDetails(log.id)}
                    >
                      {selectedEmailLogId === log.id ? '詳細を閉じる' : '詳細を表示'}
                    </button>
                    <details className="context-menu" onClick={(event) => event.stopPropagation()}>
                      <summary className="button secondary tiny">メニュー</summary>
                      <div className="context-menu-panel">
                        <button type="button" className="button secondary tiny" onClick={() => void copyText(log.id)}>
                          ログIDをコピー
                        </button>
                        <button type="button" className="button secondary tiny" onClick={() => void copyText(log.email)}>
                          メールをコピー
                        </button>
                        <button type="button" className="button secondary tiny" onClick={() => applyEmailFromLog(log.email)}>
                          このメールで絞る
                        </button>
                      </div>
                    </details>
                  </div>
                      {selectedEmailLogId === log.id && (
                        <div className="log-detail-panel inline-detail">
                          <div className="detail-section">
                            <div className="detail-title">基本情報</div>
                            <div className="detail-row">
                              <span className="detail-label">ログID</span>
                              <span className="detail-value">
                                {log.id}
                                <button type="button" className="button secondary tiny inline" onClick={() => void copyText(log.id)}>
                                  コピー
                                </button>
                              </span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">招待ID</span>
                              <span className="detail-value">
                                {log.invitationId ?? 'なし'}
                                {log.invitationId && (
                                  <button type="button" className="button secondary tiny inline" onClick={() => void copyText(log.invitationId!)}>
                                    コピー
                                  </button>
                                )}
                              </span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">日時</span>
                              <span className="detail-value">{new Date(log.createdAt).toLocaleString('ja-JP')}</span>
                            </div>
                          </div>
                          <div className="detail-section">
                            <div className="detail-title">送信状況</div>
                            <div className="detail-row">
                              <span className="detail-label">種別</span>
                              <span className="detail-value">{log.action}</span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">結果</span>
                              <span className="detail-value">{log.status}</span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">試行回数</span>
                              <span className="detail-value">{log.attempts}</span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">エラー</span>
                              <span className="detail-value">{log.errorDetail ?? 'なし'}</span>
                            </div>
                          </div>
                          <div className="detail-section">
                            <div className="detail-title">連絡先</div>
                            <div className="detail-row">
                              <span className="detail-label">メール</span>
                              <span className="detail-value">
                                {log.email}
                                <button type="button" className="button secondary tiny inline" onClick={() => void copyText(log.email)}>
                                  コピー
                                </button>
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                      {log.errorDetail && (
                        <div className="row-actions log-detail-actions">
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => toggleEmailError(log.id)}
                          >
                            {expandedEmailErrors.has(log.id) ? 'エラー詳細を隠す' : 'エラー詳細を表示'}
                          </button>
                          {expandedEmailErrors.has(log.id) && (
                            <p className="invite-notify-error">{log.errorDetail}</p>
                          )}
                        </div>
                      )}
                    </div>
                    <span className={`badge ${log.status === 'success' ? 'success' : 'error'}`}>
                      {log.status === 'success' ? '送信成功' : '送信失敗'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {emailLogsHasMore && (
              <div className="row-actions">
                <button type="button" className="button secondary" onClick={() => void loadMoreEmailLogs()} disabled={isLoadingMoreEmailLogs}>
                  {isLoadingMoreEmailLogs ? '読み込み中...' : 'もっと見る'}
                </button>
              </div>
            )}
            {!emailLogsHasMore && emailLogs.length > 0 && (
              <p className="muted pagination-hint">これ以上のログはありません。</p>
            )}
          </div>
          <div className="log-panel-side">
            <div className="side-panel">
              <div className="detail-title">詳細</div>
              {!selectedEmailLog && (
                <>
                  <p className="muted">ログを選択してください。</p>
                  <p className="muted shortcut-hint">↑/↓ / J/K で移動</p>
                </>
              )}
              {selectedEmailLog && (
                <div className="log-detail-panel" tabIndex={-1} ref={emailDetailRef}>
                  <div className="row-actions">
                    <button type="button" className="button secondary tiny" onClick={goToPrevEmailLog} disabled={selectedEmailIndex <= 0}>
                      前のログ
                    </button>
                    <button
                      type="button"
                      className="button secondary tiny"
                      onClick={goToNextEmailLog}
                      disabled={selectedEmailIndex < 0 || selectedEmailIndex >= emailLogsSorted.length - 1}
                    >
                      次のログ
                    </button>
                    <button
                      type="button"
                      className="button secondary tiny"
                      onClick={() => setSelectedEmailLogId(null)}
                    >
                      選択解除
                    </button>
                  </div>
                  <div className="detail-section">
                    <div className="detail-title">基本情報</div>
                    <div className="detail-row">
                      <span className="detail-label">ログID</span>
                      <span className="detail-value">
                        {selectedEmailLog.id}
                        <button type="button" className="button secondary tiny inline" onClick={() => void copyText(selectedEmailLog.id)}>
                          コピー
                        </button>
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">招待ID</span>
                      <span className="detail-value">
                        {selectedEmailLog.invitationId ?? 'なし'}
                        {selectedEmailLog.invitationId && (
                          <button type="button" className="button secondary tiny inline" onClick={() => void copyText(selectedEmailLog.invitationId!)}>
                            コピー
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">日時</span>
                      <span className="detail-value">{new Date(selectedEmailLog.createdAt).toLocaleString('ja-JP')}</span>
                    </div>
                  </div>
                  <div className="detail-section">
                    <div className="detail-title">送信状況</div>
                    <div className="detail-row">
                      <span className="detail-label">種別</span>
                      <span className="detail-value">{selectedEmailLog.action}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">結果</span>
                      <span className="detail-value">{selectedEmailLog.status}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">試行回数</span>
                      <span className="detail-value">{selectedEmailLog.attempts}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">エラー</span>
                      <span className="detail-value">{selectedEmailLog.errorDetail ?? 'なし'}</span>
                    </div>
                  </div>
                  <div className="detail-section">
                    <div className="detail-title">連絡先</div>
                    <div className="detail-row">
                      <span className="detail-label">メール</span>
                      <span className="detail-value">
                        {selectedEmailLog.email}
                        <button type="button" className="button secondary tiny inline" onClick={() => void copyText(selectedEmailLog.email)}>
                          コピー
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="invite-log-panel">
        <div className={`panel-header ${activeLogPanel === 'api' ? 'active' : ''}`}>
          <h2>招待APIレート制限ログ</h2>
          <button
            type="button"
            className="button secondary tiny"
            onClick={() => setActiveLogPanel('api')}
          >
            このパネルを操作
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => void exportApiLogsCsv()}
            disabled={apiLogs.length === 0 || isExportingApiLogs}
          >
            {isExportingApiLogs ? 'エクスポート中...' : 'CSVエクスポート'}
          </button>
        </div>
        <div className="log-filters">
          <label>
            期間
            <select value={apiLogRangeHours} onChange={(event) => setApiLogRangeHours(Number(event.target.value))}>
              <option value={6}>6時間</option>
              <option value={24}>24時間</option>
              <option value={168}>7日</option>
              <option value={0}>全期間</option>
            </select>
          </label>
          <label>
            種別
            <select value={apiLogActionFilter} onChange={(event) => setApiLogActionFilter(event.target.value as 'all' | 'create' | 'resend' | 'revoke')}>
              <option value="all">すべて</option>
              <option value="create">CREATE</option>
              <option value="resend">RESEND</option>
              <option value="revoke">REVOKE</option>
            </select>
          </label>
          <label>
            判定
            <select value={apiLogAllowedFilter} onChange={(event) => setApiLogAllowedFilter(event.target.value as 'all' | 'allowed' | 'blocked')}>
              <option value="all">すべて</option>
              <option value="allowed">許可</option>
              <option value="blocked">ブロック</option>
            </select>
          </label>
          <label>
            管理者ID検索
            <div className="filter-input-row">
              <input
                type="text"
                value={apiLogTriggeredByFilter}
                onChange={(event) => setApiLogTriggeredByFilter(event.target.value)}
                placeholder="admin user id"
              />
              {apiLogTriggeredByFilter && (
                <button type="button" className="button secondary tiny" onClick={() => setApiLogTriggeredByFilter('')}>
                  クリア
                </button>
              )}
            </div>
          </label>
          <label>
            IP検索
            <div className="filter-input-row">
              <input
                type="text"
                value={apiLogSourceIpFilter}
                onChange={(event) => setApiLogSourceIpFilter(event.target.value)}
                placeholder="192.168.0."
              />
              {apiLogSourceIpFilter && (
                <button type="button" className="button secondary tiny" onClick={() => setApiLogSourceIpFilter('')}>
                  クリア
                </button>
              )}
            </div>
          </label>
          <label>
            並び順
            <select value={apiLogSort} onChange={(event) => setApiLogSort(event.target.value as 'desc' | 'asc')}>
              <option value="desc">新しい順</option>
              <option value="asc">古い順</option>
            </select>
          </label>
          <button type="button" className="button secondary" onClick={resetApiLogFilters}>
            フィルタをリセット
          </button>
        </div>
        <p className="muted filter-summary">
          表示件数: {apiLogs.length} 件{apiLogsTotalCount != null ? ` / 合計: ${apiLogsTotalCount} 件` : ''} / {apiFilterSummary}
          {((apiLogTriggeredByFilter.trim() && debouncedApiLogTriggeredByFilter !== apiLogTriggeredByFilter.trim()) ||
            (apiLogSourceIpFilter.trim() && debouncedApiLogSourceIpFilter !== apiLogSourceIpFilter.trim()))
            ? '（入力反映中）'
            : ''}
        </p>

        <div className="log-panel-body">
          <div className="log-panel-list">
            {isLoadingLogs && (
              <div className="table-like">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={`api-skeleton-${index}`} className="row invite-log-row skeleton">
                    <div className="skeleton-line wide" />
                    <div className="skeleton-line" />
                  </div>
                ))}
              </div>
            )}
            {apiLogs.length === 0 && (
              <div className="empty-state">
                <p className="muted">条件に一致するAPIログはありません。</p>
                <button type="button" className="button secondary" onClick={resetApiLogFilters}>
                  フィルタをリセット
                </button>
              </div>
            )}
            {apiLogs.length > 0 && (
              <div className="table-like">
                {apiLogsSorted.map((log) => (
                  <div
                    key={log.id}
                    className={`row invite-log-row ${selectedApiLogId === log.id ? 'selected' : ''}`}
                    ref={(node) => {
                      apiLogRefs.current.set(log.id, node)
                    }}
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('button,summary,a')) return
                      toggleApiDetails(log.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        toggleApiDetails(log.id)
                      }
                    }}
                  >
                    <div>
                      <h3>{log.action.toUpperCase()} / {new Date(log.createdAt).toLocaleString('ja-JP')}</h3>
                      <p className="muted">
                        管理者: {log.triggeredBy ? highlightText(log.triggeredBy, debouncedApiLogTriggeredByFilter) : 'unknown'} / IP:{' '}
                        {log.sourceIp ? highlightText(log.sourceIp, debouncedApiLogSourceIpFilter) : 'unknown'}
                      </p>
                      <div className="row-actions">
                        {log.triggeredBy && (
                          <button type="button" className="button secondary tiny" onClick={() => applyTriggeredByFromLog(log.triggeredBy)}>
                            管理者IDで絞る
                          </button>
                        )}
                        {log.sourceIp && (
                          <button type="button" className="button secondary tiny" onClick={() => applySourceIpFromLog(log.sourceIp)}>
                            IPで絞る
                          </button>
                        )}
                      </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => toggleApiDetails(log.id)}
                    >
                      {selectedApiLogId === log.id ? '詳細を閉じる' : '詳細を表示'}
                    </button>
                    <details className="context-menu" onClick={(event) => event.stopPropagation()}>
                      <summary className="button secondary tiny">メニュー</summary>
                      <div className="context-menu-panel">
                        <button type="button" className="button secondary tiny" onClick={() => void copyText(log.id)}>
                          ログIDをコピー
                        </button>
                        {log.triggeredBy && (
                          <>
                            <button type="button" className="button secondary tiny" onClick={() => void copyText(log.triggeredBy!)}>
                              管理者IDをコピー
                            </button>
                            <button type="button" className="button secondary tiny" onClick={() => applyTriggeredByFromLog(log.triggeredBy)}>
                              管理者IDで絞る
                            </button>
                          </>
                        )}
                        {log.sourceIp && (
                          <>
                            <button type="button" className="button secondary tiny" onClick={() => void copyText(log.sourceIp!)}>
                              IPをコピー
                            </button>
                            <button type="button" className="button secondary tiny" onClick={() => applySourceIpFromLog(log.sourceIp)}>
                              IPで絞る
                            </button>
                          </>
                        )}
                      </div>
                    </details>
                  </div>
                      {selectedApiLogId === log.id && (
                        <div className="log-detail-panel inline-detail">
                          <div className="detail-section">
                            <div className="detail-title">基本情報</div>
                            <div className="detail-row">
                              <span className="detail-label">ログID</span>
                              <span className="detail-value">
                                {log.id}
                                <button type="button" className="button secondary tiny inline" onClick={() => void copyText(log.id)}>
                                  コピー
                                </button>
                              </span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">日時</span>
                              <span className="detail-value">{new Date(log.createdAt).toLocaleString('ja-JP')}</span>
                            </div>
                          </div>
                          <div className="detail-section">
                            <div className="detail-title">判定内容</div>
                            <div className="detail-row">
                              <span className="detail-label">種別</span>
                              <span className="detail-value">{log.action}</span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">判定</span>
                              <span className="detail-value">{log.allowed ? '許可' : 'ブロック'}</span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">理由</span>
                              <span className="detail-value">{log.reason ?? 'なし'}</span>
                            </div>
                          </div>
                          <div className="detail-section">
                            <div className="detail-title">送信元</div>
                            <div className="detail-row">
                              <span className="detail-label">管理者ID</span>
                              <span className="detail-value">
                                {log.triggeredBy ?? 'unknown'}
                                {log.triggeredBy && (
                                  <button type="button" className="button secondary tiny inline" onClick={() => void copyText(log.triggeredBy!)}>
                                    コピー
                                  </button>
                                )}
                              </span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">送信元IP</span>
                              <span className="detail-value">
                                {log.sourceIp ?? 'unknown'}
                                {log.sourceIp && (
                                  <button type="button" className="button secondary tiny inline" onClick={() => void copyText(log.sourceIp!)}>
                                    コピー
                                  </button>
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                      {log.reason && (
                        <div className="row-actions log-detail-actions">
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => toggleApiReason(log.id)}
                          >
                            {expandedApiReasons.has(log.id) ? '理由を隠す' : '理由を表示'}
                          </button>
                          {expandedApiReasons.has(log.id) && <p className="invite-notify-error">理由: {log.reason}</p>}
                        </div>
                      )}
                    </div>
                    <span className={`badge ${log.allowed ? 'success' : 'error'}`}>
                      {log.allowed ? '許可' : 'ブロック'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {apiLogsHasMore && (
              <div className="row-actions">
                <button type="button" className="button secondary" onClick={() => void loadMoreApiLogs()} disabled={isLoadingMoreApiLogs}>
                  {isLoadingMoreApiLogs ? '読み込み中...' : 'もっと見る'}
                </button>
              </div>
            )}
            {!apiLogsHasMore && apiLogs.length > 0 && (
              <p className="muted pagination-hint">これ以上のログはありません。</p>
            )}
          </div>
          <div className="log-panel-side">
            <div className="side-panel">
              <div className="detail-title">詳細</div>
              {!selectedApiLog && (
                <>
                  <p className="muted">ログを選択してください。</p>
                  <p className="muted shortcut-hint">↑/↓ / J/K で移動</p>
                </>
              )}
              {selectedApiLog && (
                <div className="log-detail-panel" tabIndex={-1} ref={apiDetailRef}>
                  <div className="row-actions">
                    <button type="button" className="button secondary tiny" onClick={goToPrevApiLog} disabled={selectedApiIndex <= 0}>
                      前のログ
                    </button>
                    <button
                      type="button"
                      className="button secondary tiny"
                      onClick={goToNextApiLog}
                      disabled={selectedApiIndex < 0 || selectedApiIndex >= apiLogsSorted.length - 1}
                    >
                      次のログ
                    </button>
                    <button
                      type="button"
                      className="button secondary tiny"
                      onClick={() => setSelectedApiLogId(null)}
                    >
                      選択解除
                    </button>
                  </div>
                  <div className="detail-section">
                    <div className="detail-title">基本情報</div>
                    <div className="detail-row">
                      <span className="detail-label">ログID</span>
                      <span className="detail-value">
                        {selectedApiLog.id}
                        <button type="button" className="button secondary tiny inline" onClick={() => void copyText(selectedApiLog.id)}>
                          コピー
                        </button>
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">日時</span>
                      <span className="detail-value">{new Date(selectedApiLog.createdAt).toLocaleString('ja-JP')}</span>
                    </div>
                  </div>
                  <div className="detail-section">
                    <div className="detail-title">判定内容</div>
                    <div className="detail-row">
                      <span className="detail-label">種別</span>
                      <span className="detail-value">{selectedApiLog.action}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">判定</span>
                      <span className="detail-value">{selectedApiLog.allowed ? '許可' : 'ブロック'}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">理由</span>
                      <span className="detail-value">{selectedApiLog.reason ?? 'なし'}</span>
                    </div>
                  </div>
                  <div className="detail-section">
                    <div className="detail-title">送信元</div>
                    <div className="detail-row">
                      <span className="detail-label">管理者ID</span>
                      <span className="detail-value">
                        {selectedApiLog.triggeredBy ?? 'unknown'}
                        {selectedApiLog.triggeredBy && (
                          <button type="button" className="button secondary tiny inline" onClick={() => void copyText(selectedApiLog.triggeredBy!)}>
                            コピー
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">送信元IP</span>
                      <span className="detail-value">
                        {selectedApiLog.sourceIp ?? 'unknown'}
                        {selectedApiLog.sourceIp && (
                          <button type="button" className="button secondary tiny inline" onClick={() => void copyText(selectedApiLog.sourceIp!)}>
                            コピー
                          </button>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
