// Ask's rows in the platform's sidebar. New chat and My Questions go here in Step 2.
import { createElement } from 'react'
import { Bot } from '@featherbase/shop-floor'

export function Sidebar() {
  // featherbase-sidebar is the platform's own element: the app supplies only its rows.
  return createElement(
    'featherbase-sidebar',
    { className: 'ask-sidebar', 'aria-label': 'Ask' },
    <a href="./" aria-current="page">
      <Bot aria-hidden="true" size={18} />
      <span>Ask</span>
    </a>,
  )
}