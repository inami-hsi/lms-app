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

const getRoleFromProfile = async (userId: string, email: string): Promise<UserRole> => {
  if (!supabase) return toRole(email)

  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()

  if (error || !data?.role) {
    return toRole(email)
  }

  return data.role === 'admin' ? 'admin' : 'learner'
}

const isEmailAllowed = async (email: string) => {
  if (!supabase) return false

  const { data, error } = await supabase
    .from('allowed_emails')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (error) {
    return false
  }

  return Boolean(data?.id)
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

    supabase.auth.getSession().then(async ({ data }) => {
      await resolveUser(data.session)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
      await resolveUser(session)
      setLoading(false)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  const signInWithGoogle = async () => {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Supabase環境変数が未設定です。VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を設定してください。')
    }

    setAuthError(null)

    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    })
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
