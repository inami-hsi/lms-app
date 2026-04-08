import { Link } from 'react-router-dom'

export const AdminDashboardPage = () => {
  return (
    <section>
      <h1>管理ダッシュボード</h1>
      <p className="muted">受講状況のサマリーと管理画面へのショートカットです。</p>

      <div className="stat-grid">
        <article className="stat-card">
          <h2>登録ユーザー</h2>
          <p className="stat-value">24</p>
        </article>
        <article className="stat-card">
          <h2>公開コース</h2>
          <p className="stat-value">2</p>
        </article>
        <article className="stat-card">
          <h2>平均進捗</h2>
          <p className="stat-value">48%</p>
        </article>
      </div>

      <div className="inline-actions">
        <Link to="/admin/courses" className="button primary">コース管理へ</Link>
        <Link to="/admin/users" className="button secondary">ユーザー管理へ</Link>
        <Link to="/admin/reports" className="button secondary">進捗レポートへ</Link>
      </div>
    </section>
  )
}
