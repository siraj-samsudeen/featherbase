# Feather Ask: the page

Issue: [#1377](https://github.com/siraj-samsudeen/featherbase/issues/1377), Phase 1.
Built by Mohammad with Claude Code on branch `issue-1377-ask-ui`. The answers themselves come
from the companion change `feather-ask-agent`; this change is the page and the saved chats.

## Why

People want to ask about their data in plain words, without knowing which app or Table holds it.
Feather Ask gives everyone signed in one place to ask, read the answer, and come back to earlier
chats, laid out the way ChatGPT, Claude and Gemini are, so nobody has to learn it.

## What Changes

- Ship Ask as an app shipped with the platform (`example-apps/ask`), opt-in per instance, open to
  everyone signed in. Each person sees only their own chats.
- An empty page with a few example questions and one box to ask in.
- Each question shows with its answer below it; a failed question can be tried again in place.
- Every question is saved with its answer, in a chat titled by its first question.
- The sidebar starts a new chat and lists the person's recent chats; a Recent Chats page lists
  them all, 50 at a time. A saved chat opens in Ask and can be carried on.

Departs from #1377's Agreed design, by the owner's decision: the list is called **Recent Chats**,
not "My Questions" (it lists whole chats, and the three assistants above use that wording).

Not in this change: what the answer says (`feather-ask-agent`), renaming or deleting a chat,
grouping chats by date, the panel on every page, and the details under a figures answer
(#1377 points 14 and 15).

The specs follow one person, Selvi, who asks "How many open tickets do I have?", and Ravi,
who has no tickets.

## Capabilities

### New Capabilities

- `feather-ask`: ask a question in plain words, see its answer, keep and reopen chats.

### Modified Capabilities

None.

## Impact

- New app `example-apps/ask` (manifest, server action, React page), installed by
  `tools/prepare-apps.mjs`; a README section on opting in.
- A new platform icon `bot`; Shop Floor's icons gain `ArrowUpRight`.
- Server test `apps/server/test/ask-app.test.ts`.
