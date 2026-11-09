// #1101: a change an agent made through /mcp reads "<person> edited via <token
// label>": the actor stays the person, and this chip after the verb names the
// access token the agent used. A change made by hand has none.
export function AgentMark({ label }: { label?: string }) {
  if (!label) return null
  return (
    <>
      {' '}
      <span data-testid="activity-via" className="rounded-full bg-subtle px-1.5 py-px text-xs text-ink-subtle [overflow-wrap:anywhere]">
        via {label}
      </span>
    </>
  )
}
