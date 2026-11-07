# Your sections, with approval

## Why

HR's data is loaded as it is. When people sign in they either see the sections assigned to them or they don't, and the ones who don't should be able to fix it with their manager instead of a mass cleanup. Today nobody can see what is mapped to them, and only a master data editor can change it.

## What changes

- **Your sections in Dash:** a person sees their job, store, manager, sections and subcategories, and can propose three corrections. Dash's empty screens link here.
- **Waiting for your approval in Dash:** the person's manager approves or rejects. With no manager, or a manager who can't sign in yet, a Master Data Editor does.
- **The platform's Change Proposal, first slice of #627:** one Table holding a proposed change, with one child row per changed column. Nothing changes until it is approved. Nobody approves their own. Approving ends the old row and adds a new dated row, so history stays.
- **Base Tables for an app:** an app declares which Tables and columns of the instance it reads and proposes on, and an administrator lists them in its settings. Staff get no generic read on HR's data.
- **The bar:** a bar control can stay away from an app's pages it doesn't apply to.

Not here: #627's configurable rules and Admin screen, notifying approvers, cancelling a proposal, and posting to StyleHR, whose API isn't ready.

## Capabilities

### New

- `my-sections`: what a person sees and proposes, and what an approver decides.

### Modified

- `workflow-and-approvals`: a change can wait for approval as a Change Proposal.
- `transactional-runtime-actions`: an app can read declared base Tables and propose changes to them.
