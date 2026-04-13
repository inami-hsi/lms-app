/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'

import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { AuthUser, UserRole } from '../types/lms'

type AuthContextValue = {
  user: AuthUser | null
  loading: boolean
  authError: string | null
  signInWithGoogle: () => Promise<void>
  signInDemo: (role: UserRole) => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const toRole = (email: string): UserRole => (email.endsWith('@admin.local') ? 'admin' : 'learner')

const withTimeout = async <T,>(promiseLike: PromiseLike<T>, ms: number): Promise<T | null> => {
  const timeout = new Promise<null>((resolve) => {
    window.setTimeout(() => resolve(null), ms)
  })
  return Promise.race([Promise.resolve(promiseLike), timeout])
}

const getRoleFromProfile = async (userId: string, email: string): Promise<UserRole> => {
  if (!supabase) return toRole(email)

  const result = await withTimeout(supabase.from('profiles').select('role').eq('id', userId).maybeSingle(), 4000)

  if (!result || result.error || !result.data) {
    return toRole(email)
  }

  const data = result.data as unknown
  if (typeof data !== 'object' || data === null) return toRole(email)
  const role = (data as { role?: unknown }).role
  if (role !== 'admin' && role !== 'learner') return toRole(email)
  return role
}

const isEmailAllowed = async (email: string) => {
  if (!supabase) return false

  const result = await withTimeout(supabase.from('allowed_emails').select('id').eq('email', email).maybeSingle(), 4000)

  if (!result || result.error) {
    return false
  }

  const data = result.data as unknown
  if (typeof data !== 'object' || data === null) return false
  return Boolean((data as { id?: unknown }).id)
}

const sessionToUser = (session: Session | null): AuthUser | null => {
  if (!session?.user.email) return null

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.user_metadata.full_name ?? session.user.email,
    role: toRole(session.user.email),
  }
}

const getStoredSessionFallback = (): Session | null => {
  if (!isSupabaseConfigured || !supabase) return null

  try {
    const url = new URL(import.meta.env.VITE_SUPABASE_URL)
    const ref = url.hostname.split('.')[0]
    const key = `sb-${ref}-auth-token`
    const raw = localStorage.getItem(key)
    if (!raw) return null

    const data = JSON.parse(raw)
    if (!data?.user) return null

    return { user: data.user } as Session
  } catch {
    return null
  }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const resolveUser = async (session: Session | null) => {
    const mapped = sessionToUser(session)
    if (!mapped) {
      setUser(null)
      return
    }

    const role = await getRoleFromProfile(mapped.id, mapped.email)

    if (role !== 'admin') {
      const allowed = await isEmailAllowed(mapped.email)
      if (!allowed) {
        if (supabase) {
          await supabase.auth.signOut()
        }
        setUser(null)
        setAuthError('このメールアドレスはアクセス許可されていません。管理者からの招待リンクを確認してください。')
        return
      }
    }

    setAuthError(null)
    setUser({ ...mapped, role })
  }

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false)
      return
    }

    const client = supabase
    let cancelled = false
    const finishLoading = () => {
      if (!cancelled) setLoading(false)
    }

    const resolveWithFallback = async (session: Session | null) => {
      try {
        await resolveUser(session)
      } catch (error) {
        console.error('auth resolve error', error)
        setUser(null)
        setAuthError('認証状態の確認に失敗しました。再読み込みしてください。')
      }
    }

    const runInitialCheck = async () => {
      try {
        const { data, error } = await client.auth.getSession()
        if (cancelled) return
        if (error) throw error

        const session = data.session ?? getStoredSessionFallback()
        // Never block rendering on network/RLS issues.
        void resolveWithFallback(session).finally(finishLoading)
      } catch (error) {
        console.error('auth session error', error)
        const fallback = getStoredSessionFallback()
        if (fallback) {
          void resolveWithFallback(fallback).finally(finishLoading)
        } else {
          setUser(null)
          setAuthError('認証状態の確認に失敗しました。再読み込みしてください。')
          finishLoading()
        }
      }
    }

    runInitialCheck()

    const { data } = client.auth.onAuthStateChange(async (_event, session) => {
      void resolveWithFallback(session).finally(finishLoading)
    })

    const timeoutId = window.setTimeout(async () => {
      if (cancelled) return
      // Safety net: never keep the app on a spinner forever.
      finishLoading()
    }, 5000)

    return () => {
      cancelled = true
      data.subscription.unsubscribe()
      window.clearTimeout(timeoutId)
    }
  }, [])

  const signInWithGoogle = async () => {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Supabase環境変数が未設定です。VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を設定してください。')
    }

    setAuthError(null)

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Keep the full URL (path + query) so invite accept keeps `?token=...` after OAuth redirect.
        redirectTo: window.location.href,
      },
    })

    // In some failure cases (misconfigured provider/redirect URI), Supabase returns an error without redirecting.
    if (error) {
      throw error
    }

    // supabase-js may auto-redirect in the browser, but explicitly navigate when a URL is returned.
    if (data?.url) {
      window.location.assign(data.url)
    }
  }

  const signInDemo = (role: UserRole) => {
    setAuthError(null)
    setUser({
      id: role === 'admin' ? 'demo-admin' : 'demo-learner',
      email: role === 'admin' ? 'owner@admin.local' : 'learner@example.com',
      name: role === 'admin' ? '管理者デモ' : '受講者デモ',
      role,
    })
  }

  const signOut = async () => {
    if (supabase) {
      await supabase.auth.signOut()
    }
    setUser(null)
  }

  const value = useMemo(
    () => ({ user, loading, authError, signInWithGoogle, signInDemo, signOut }),
    [authError, loading, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return context
}
