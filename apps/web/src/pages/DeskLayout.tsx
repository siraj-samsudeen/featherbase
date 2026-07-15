import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { clearSession, getSessionUser, listResource } from '../lib/api'

export function DeskLayout() {
  const navigate = useNavigate()
  const user = getSessionUser()

  const doctypes = useQuery({
    queryKey: ['doctypes'],
    queryFn: () =>
      listResource<{ name: string; module: string }>('DocType', {
        filters: [['istable', '=', false]],
        fields: ['name', 'module'],
        order_by: 'name asc',
        limit_page_length: 200,
      }),
  })

  function logout() {
    clearSession()
    navigate({ to: '/login' })
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <span className="text-sm font-semibold text-gray-900">Desk</span>
          <button
            onClick={logout}
            data-testid="logout"
            className="text-xs text-gray-500 hover:text-gray-900"
          >
            Log out
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2" data-testid="doctype-nav">
          {doctypes.isLoading && (
            <p className="px-2 py-1 text-xs text-gray-400">Loading…</p>
          )}
          {doctypes.data?.data.map((dt) => (
            <Link
              key={dt.name}
              to="/desk/$doctype"
              params={{ doctype: dt.name }}
              className="block rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-200"
              activeProps={{ className: 'bg-gray-200 font-medium' }}
            >
              {dt.name}
            </Link>
          ))}
        </nav>
        <div className="border-t border-gray-200 p-3 text-xs text-gray-500" data-testid="session-user">
          {user?.full_name || user?.name}
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
