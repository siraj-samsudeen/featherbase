import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, within } from 'storybook/test'
import { DEFAULT_SETTINGS } from '../lib/settings'
import { activityQuery, type VersionRow } from './Comments'
import { ActivityTimeline } from './ActivityTimeline'

// #1101: a row an agent created and moved through /mcp, then its person moved
// it again by hand. Made-up people and a made-up token label.
const TABLE = 'Customer'
const ROW = 'CUST-0042'
const MEENA = 'psn_meenaaaaaaaaaaaaaaaa'
const LABEL = 'Claude on my laptop'
const agent = { token_id: 'tok_story', token_label: LABEL }

const versions: VersionRow[] = [
  { created_by: MEENA, created_at: '2026-11-09T08:30:00Z', data: { created: true, changed: [], agent } },
  { created_by: MEENA, created_at: '2026-11-09T08:32:00Z', data: { changed: [['city', 'Chennai', 'Salem']], agent } },
  { created_by: MEENA, created_at: '2026-11-09T09:05:00Z', data: { changed: [['city', 'Salem', 'Madurai']] } },
]

/** A cache already holding the row's activity, its Table and the names, so the story needs no server. */
function seeded() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(activityQuery(TABLE, ROW).queryKey, {
    created: { created_by: MEENA, created_at: '2026-11-09T08:30:00Z' },
    comments: [],
    versions,
  })
  client.setQueryData(['meta', TABLE], { name: TABLE, columns: [{ column_name: 'city', label: 'City', column_type: 'Data' }] })
  client.setQueryData(['settings'], DEFAULT_SETTINGS)
  client.setQueryData(['principal-name', MEENA], 'Meena Iyer')
  return client
}

/**
 * A row's Activity. A change made through an agent reads "<person> edited via <token label>": the person stays
 * the actor, and a subdued chip names the access token the agent used. A row an agent created opens with
 * "created this via <token label>", once. A change made by hand has no chip.
 */
const meta = {
  title: 'Admin/Row/ActivityTimeline',
  component: ActivityTimeline,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { table: TABLE, name: ROW },
  decorators: [(Story) => <QueryClientProvider client={seeded()}><div className="max-w-xl"><Story /></div></QueryClientProvider>],
} satisfies Meta<typeof ActivityTimeline>
export default meta
type Story = StoryObj<typeof meta>

async function readsTheAgentMark(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await expect(await canvas.findByTestId('activity-created')).toHaveTextContent(new RegExp(`^Meena Iyer created this via ${LABEL} · `))
  const [byAgent, byHand] = canvas.getAllByTestId('activity-version')
  await expect(canvas.getAllByTestId('activity-version')).toHaveLength(2)
  await expect(byAgent).toHaveTextContent(new RegExp(`^Meena Iyer edited via ${LABEL} · `))
  await expect(byHand).toHaveTextContent(/^Meena Iyer edited · /)
}

export const ThroughAnAgent: Story = {
  name: 'Changes through an agent',
  play: ({ canvasElement }) => readsTheAgentMark(canvasElement),
}

export const ThroughAnAgentDark: Story = {
  name: 'Changes through an agent, dark',
  decorators: [(Story) => <div data-theme="dark" className="bg-canvas p-4"><Story /></div>],
  play: ({ canvasElement }) => readsTheAgentMark(canvasElement),
}
