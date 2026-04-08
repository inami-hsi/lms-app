type UserReport = {
  user: string
  course: string
  progress: number
}

const reports: UserReport[] = [
  { user: 'member1@example.com', course: '生成AI実践入門', progress: 80 },
  { user: 'member2@example.com', course: '生成AI実践入門', progress: 40 },
  { user: 'member3@example.com', course: 'SNS導線設計マスター', progress: 60 },
]

export const AdminReportsPage = () => {
  return (
    <section>
      <h1>進捗レポート</h1>
      <p className="muted">ユーザー別の学習進捗を確認できます。</p>

      <div className="table-like">
        {reports.map((report) => (
          <div key={`${report.user}-${report.course}`} className="row">
            <div>
              <h3>{report.user}</h3>
              <p className="muted">{report.course}</p>
            </div>
            <span className="badge neutral">{report.progress}%</span>
          </div>
        ))}
      </div>
    </section>
  )
}
