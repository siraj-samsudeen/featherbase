// Ask's page: the sidebar, then the chat. The shared top bar is added by the
// platform's server; the app never draws it.
import { Chat } from './Chat'
import { Sidebar } from './Sidebar'

export function HomePage() {
  return (
    <div className="ask-shell">
      <Sidebar />
      {/* Chat must come right after the sidebar: the platform styles that element as the page panel. */}
      <Chat />
    </div>
  )
}