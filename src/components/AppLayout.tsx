import { Link, NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '../auth/AuthContext'

const navItems = [
  { to: '/', label: 'コース一覧' },
  { to: '/mypage', label: 'マイページ' },
]

const adminItems = [
  { to: '/admin', label: '管理ダッシュボード' },
  { to: '/admin/courses', label: 'コース管理' },
  { to: '/admin/users', label: 'ユーザー管理' },
  { to: '/admin/reports', label: '進捗レポート' },
]

export const AppLayout = () => {
  const { user, signOut } = useAuth()

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          LMS
        </Link>
        <nav className="main-nav">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              {item.label}
            </NavLink>
          ))}
          {user?.role === 'admin' &&
            adminItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                {item.label}
              </NavLink>
            ))}
        </nav>
        <div className="header-right">
          <span className="user-chip">{user?.name}</span>
          <button type="button" className="button secondary" onClick={() => void signOut()}>
            ログアウト
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
