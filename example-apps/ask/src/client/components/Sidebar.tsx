// Ask's rows in the platform's sidebar: New chat and My Questions. They are the
// router's links: real links (Ctrl+click opens a new tab), but a click changes the
// page in place, with no reload.
import { createElement } from 'react'
import { Link } from 'react-router'
import { History, Plus } from '@featherbase/shop-floor'

export type Page = 'chat' | 'questions'

export function Sidebar({ page }: { page: Page }) {
  // featherbase-sidebar is the platform's own element: the app supplies only its rows.
  return createElement(
    'featherbase-sidebar',
    { className: 'ask-sidebar', 'aria-label': 'Ask' },
    <Link to="/" aria-current={page === 'chat' ? 'page' : undefined}>
      <Plus aria-hidden="true" size={18} />
      <span>New chat</span>
    </Link>,
    <Link to="/?view=questions" aria-current={page === 'questions' ? 'page' : undefined}>
      <History aria-hidden="true" size={18} />
      <span>My Questions</span>
    </Link>,
  )
}
