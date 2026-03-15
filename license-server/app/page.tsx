export default function HomePage() {
  return (
    <main className="container">
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Loha License Server</h1>
        <p>API endpoints:</p>
        <ul>
          <li><code>POST /api/license/activate</code></li>
          <li><code>GET /api/license/status</code></li>
          <li><code>POST /api/admin/keys/create</code></li>
          <li><code>GET /api/admin/keys/list</code></li>
          <li><code>POST /api/admin/keys/revoke</code></li>
        </ul>
        <p>Admin panel: <a href="/admin">/admin</a></p>
      </div>
    </main>
  )
}
