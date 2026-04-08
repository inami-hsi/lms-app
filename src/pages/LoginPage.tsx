import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/AuthContext'
import { isSupabaseConfigured } from '../lib/supabase'

export const LoginPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { signInWithGoogle, signInDemo, authError } = useAuth()
  const [error, setError] = useState('')

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const goDemo = (role: 'admin' | 'learner') => {
    signInDemo(role)
    navigate(from, { replace: true })
  }

  const handleGoogleLogin = async () => {
    try {
      setError('')
      await signInWithGoogle()
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'ログインに失敗しました。')
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>学習管理システム</h1>
        <p className="muted">Googleアカウントでログインして受講を開始できます。</p>

        <button type="button" className="button primary" onClick={() => void handleGoogleLogin()}>
          Googleでログイン
        </button>

        {!isSupabaseConfigured && (
          <p className="alert warning">現在はデモモードです。環境変数を設定するとGoogle OAuthに切り替わります。</p>
        )}

        <div className="demo-actions">
          <button type="button" className="button secondary" onClick={() => goDemo('learner')}>
            受講者デモで入る
          </button>
          <button type="button" className="button secondary" onClick={() => goDemo('admin')}>
            管理者デモで入る
          </button>
        </div>

        {error && <p className="alert error">{error}</p>}
        {authError && <p className="alert error">{authError}</p>}
      </div>
    </div>
  )
}
