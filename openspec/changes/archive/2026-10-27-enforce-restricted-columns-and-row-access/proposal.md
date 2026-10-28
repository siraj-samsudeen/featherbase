# Proposal

## Why

A column marked sensitive, such as a salary or a cost price, is meant to stay hidden from everyone without the deeper access. Before go-live it still leaked in four places. It showed inside a row's line items. It went out in webhook calls and rule emails. Scheduled report emails ran with full access. And anyone with a broad grant on comments could read the comments and edit history of rows they cannot open. Store staff and outside recipients would see figures they were never meant to.

## What Changes

- A sensitive column inside a row's line items is hidden like one on the row itself. This covers opening the row, the reply after saving it, and printing it. A person without the deeper access can't change it there either.
- Webhook calls and rule emails never carry a sensitive column. A rule may still match on one, or take its recipient's address from one.
- A scheduled report email shows the rows and columns that the person who set it up can see. It carries every such row, not the first 500. A schedule whose creator can no longer sign in sends nothing.
- Comments and edit history are readable only by someone who can open the row they belong to. Edits never show a change to a column hidden from the reader.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `permissions-and-roles`: a sensitive column is hidden inside line items, after a save and in print.
- `notifications-email-and-webhooks`: webhooks and rule emails leave sensitive columns out.
- `reports-and-charts`: a scheduled report email runs as its creator and is never cut short.
- `comments-and-history`: comments and history follow the row's own access.

## Impact

Server row loading, the save, submit and cancel replies, child-row writes, printing, webhooks, email rules, scheduled reports, and the list scoping of comments and history. The form's comment and activity panels read the row's activity. No schema change and no migration.
