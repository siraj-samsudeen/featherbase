// #1340: the shared Links pieces and the finding card, as any page composes them: plain props, no server.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { FindingCard, LinkLine, LinkSection, TickMark, ToneChip } from '@featherbase/shop-floor'

describe('FindingCard', () => {
  test('says its count, name, reason and owner; pressed, it says so, and a press reports', () => {
    const onSelect = vi.fn()
    render(<FindingCard count={1234} title="Need A Decision" reason="Old grants only" owner="Owner decides" tone="caution" selected onSelect={onSelect} />)
    const card = screen.getByRole('button', { name: /Need A Decision/ })
    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('finding-count')).toHaveTextContent('1,234')
    expect(card).toHaveTextContent('Old grants onlyOwner decides')
    fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledOnce()
  })

  test('with nothing to press, it is a plain card with no owner line', () => {
    render(<FindingCard count={0} title="Lose Dash" reason="No role opens it" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByTestId('finding-card')).toHaveTextContent('0Lose DashNo role opens it')
  })
})

describe('the Links pieces', () => {
  test('a tick says locked, on or off in its name; a chip says its tone', () => {
    render(<ul>
      <LinkLine lead={<TickMark state="locked" label="Store Manager, held" />} side={<ToneChip>from HR</ToneChip>} note="Lakeside" below="Why it is">Store Manager</LinkLine>
      <LinkLine lead={<TickMark state="on" label="On" />}>Second</LinkLine>
      <LinkLine lead={<TickMark state="off" label="Off" />}>Third</LinkLine>
      <LinkLine>No tick</LinkLine>
    </ul>)
    expect(screen.getByRole('img', { name: 'Store Manager, held' })).toHaveAttribute('data-state', 'locked')
    expect(screen.getByRole('img', { name: 'On' })).toHaveTextContent('✓')
    expect(screen.getByRole('img', { name: 'Off' })).toHaveTextContent('')
    expect(screen.getByTestId('source-chip')).toHaveAttribute('data-tone', 'quiet')
    expect(screen.getAllByTestId('link-line')[0]).toHaveTextContent('Store ManagerLakesidefrom HRWhy it is')
  })

  test('a section says its heading and count, a number Indian-grouped or words as given, or what it says when empty', () => {
    render(<>
      <LinkSection heading="People" count={12345} id="people"><li>One</li></LinkSection>
      <LinkSection heading="Reports" count="3 of 14"><li>Two</li></LinkSection>
      <LinkSection heading="Nobody" empty={<p>None yet</p>}><li>Hidden</li></LinkSection>
    </>)
    expect(screen.getByRole('region', { name: 'People' })).toHaveTextContent('People12,345One')
    expect(screen.getByRole('region', { name: 'Reports' })).toHaveTextContent('3 of 14')
    expect(screen.getByRole('region', { name: 'Nobody' })).toHaveTextContent('NobodyNone yet')
  })
})
