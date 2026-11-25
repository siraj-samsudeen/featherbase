// Ask's page: the sidebar, then the page the address asks for. The shared top bar is
// added by the platform's server; the app never draws it.
//   /ask/                  a new chat
//   /ask/?view=questions   My Questions
import { useLocation, useSearchParams } from 'react-router'
import { Chat } from './Chat'
import { MyQuestions } from './MyQuestions'
import { Sidebar, type Page } from './Sidebar'

export function HomePage() {
  // The router updates these on every link click, Back and Forward, with no reload.
  const [params] = useSearchParams()
  const location = useLocation()
  const page: Page = params.get('view') === 'questions' ? 'questions' : 'chat'
  return (
    <div className="ask-shell">
      <Sidebar page={page} />
      {/* The page must come right after the sidebar: the platform styles that element as the page panel.
          Every visit has its own key, so New chat starts afresh even from a chat already open. */}
      {page === 'questions' ? <MyQuestions /> : <Chat key={location.key} />}
    </div>
  )
}