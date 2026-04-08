import { Link } from 'react-router-dom'

export const NotFoundPage = () => {
  return (
    <section>
      <h1>ページが見つかりません</h1>
      <p className="muted">URLをご確認ください。</p>
      <Link to="/" className="button primary">
        トップへ戻る
      </Link>
    </section>
  )
}
