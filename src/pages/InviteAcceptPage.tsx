import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { useAuth } from '../auth/AuthContext'
import { acceptInvitationToken, getInvitationInfoByToken } from '../data/lmsRepository'

const statusMessage: Record<string, string> = {
  accepted: '招待を受諾しました。コース一覧へ移動できます。',
  invalid: '招待リンクが無効です。管理者に再発行を依頼してください。',
  expired: '招待リンクの有効期限が切れています。管理者に再送信を依頼してください。',
  'already-used': 'この招待リンクはすでに使用済みです。',
  'email-mismatch': 'ログイン中のメールアドレスが招待先と一致しません。',
}

export const InviteAcceptPage = () => {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const { user, accessAllowed, signInWithGoogle, signInDemo } = useAuth()
  const [loading, setLoading] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [result, setResult] = useState<string>('')
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    const load = async () => {
      if (!token) return
      const invite = await getInvitationInfoByToken(token)
      setInviteEmail(invite?.emailMasked ?? '')
    }

    void load()
  }, [token])

  const canAccept = useMemo(() => Boolean(user && token), [token, user])

  const handleAccept = async () => {
    if (!user || !token) return
    setLoading(true)

    try {
      const status = await acceptInvitationToken({
        token,
        userEmail: user.email,
        userId: user.id,
      })
      setResult(status)

      if (status === 'accepted') {
        setTimeout(() => {
          // Full reload so AuthContext re-checks allowed_emails and protected routes work immediately.
          window.location.assign('/')
        }, 1000)
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '招待受諾に失敗しました。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>招待受諾</h1>
        <p className="muted">招待メール経由の受講登録を行います。</p>

        {!token && <p className="alert error">招待トークンが見つかりません。</p>}
        {token && inviteEmail && <p className="muted">招待先メール: {inviteEmail}</p>}

        {!user && (
          <>
            <button
              type="button"
              className="button primary"
              onClick={() => {
                setAuthError('')
                void signInWithGoogle(window.location.href).catch((error) => {
                  setAuthError(error instanceof Error ? error.message : 'ログインに失敗しました。')
                })
              }}
            >
              Googleでログインして続行
            </button>
            <div className="demo-actions">
              <button type="button" className="button secondary" onClick={() => signInDemo('learner')}>
                受講者デモで確認
              </button>
              <button type="button" className="button secondary" onClick={() => signInDemo('admin')}>
                管理者デモで確認
              </button>
            </div>
          </>
        )}

        {user && <p className="muted">ログイン中: {user.email}</p>}
        {authError && <p className="alert error">{authError}</p>}
        {user && !accessAllowed && !result && (
          <p className="alert warning">
            このメールアドレスはまだアクセス許可されていません。下の「この招待を受諾する」を押してください。
          </p>
        )}

        <button
          type="button"
          className="button primary"
          onClick={() => void handleAccept()}
          disabled={!canAccept || loading}
        >
          {loading ? '受諾処理中...' : 'この招待を受諾する'}
        </button>

        {result && <p className={result === 'accepted' ? 'alert warning' : 'alert error'}>{statusMessage[result]}</p>}

        <Link to="/" className="button secondary">トップへ戻る</Link>
      </div>
    </div>
  )
}
