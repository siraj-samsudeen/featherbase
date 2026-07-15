import { Outlet } from '@tanstack/react-router'

export function DeskLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-gray-200 bg-gray-50 p-4">
        <div className="text-sm font-semibold text-gray-900">Desk</div>
        <nav className="mt-4 text-sm text-gray-500" data-testid="doctype-nav">
          {/* DocType navigation arrives with UI-001 */}
        </nav>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
