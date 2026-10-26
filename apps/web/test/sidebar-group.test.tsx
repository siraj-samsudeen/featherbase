// A sidebar group with nothing visible for this person drops its heading too.
import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Database } from '../src/components/ui/icons'
import { SidebarGroup } from '../src/pages/AdminLayout'

test('an empty group renders nothing, heading included', () => {
  const { container } = render(<SidebarGroup heading="Data" icon={Database} testid="g" items={[]} />)
  expect(container).toBeEmptyDOMElement()
})
