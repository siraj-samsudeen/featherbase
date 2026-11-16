## Context

`report-access-server.ts` gates every read and action on `managesAccess` (Report Access Manager or System Manager). The page's writes go through `ctx.documents`, as the signed-in person, so the writer needs a Table permission on `dash.report_access`. A Table permission also opens the generic Table API.

## Decisions

### A new role, not a scope on the existing one

**Team Report Manager** is its own role. Rejected: giving the power to everyone with direct reports (no opt-in: every store manager would gain it the day it ships) and a flag on Report Access Manager (the existing role would change meaning and its holders would need re-granting). A role is opt-in, revocable, shows in the person's roles, and leaves the company-wide role untouched. Decided by: consistency (access is given by roles today) and least surprise.

### My team = direct reports today

A person is in the manager's team when one of their current Job Assignments (`holdsOn` today, Employee `Current`, with a sign-in) has `reports_to` equal to one of the manager's current Employee ids or one of the manager's current Job Assignment ids. Direct reports only, not the whole line below: the request was "their own buyers", and a wider reach is easy to add later and hard to take back. The manager is never in their own team.

### What they can give

- A report they can open themselves: in `reportsGivenTo(manager)` today.
- A bundle whose every report they can open today, and which is not empty. A bundle a company-wide manager later grows can widen what was given; bundles are made only by company-wide managers, so that stays their call.

### What they can take away

Only a grant they gave (`created_by` is them) to someone in their team. Their Table permission is `scope_mode: creator`, so they can neither read nor change anyone else's rows through the platform.

### The bypass guard

The role holds read, create and update on `dash.report_access`, own rows only. On its own that lets a Team Report Manager write any grant through the generic Table API. The save rule closes it: when the writer holds neither Report Access Manager nor System Manager (and isn't Administrator), the row is accepted only inside Dash's `give_report` or `remove_report_access` action, after that action checked the team rules, for exactly the row it checked. The action marks the save with an `AsyncLocalStorage` entry that only Dash's server module can set; the generic API never runs through it. The platform tells save rules the writer's roles (additive).

### The page

One page, narrowed by the read: `access_page` returns `scope: 'team'`, the team list, and only what may be given. The person picker has two layouts behind a toggle: a list of the team to choose from, or the existing type-a-name search limited to the team.

### Shipping the write grant: ADR 0026, after #1169

An upgrade may not add a write on a Table the app already had (#437, #1192), so production's Dash could not take this version as first built. The owner settled that case as ADR 0026 ("a wider grant waits for a System Manager's approval"), built in #1169. With it, the upgrade creates Team Report Manager with its two reads at once, and the `dash.report_access` grant (read, create, update; `scope_mode: creator`) waits in Apps until a System Manager approves it. Approval applies the declared permission object as it is, through the same `provisionGrants` an install uses, so "own rows only" survives. Not loosened here: the #1192 rule.

While the grant waits, Dash must say so plainly (ADR 0026's consequence): give and remove check the caller's real permission with #1169's `documents.can`, and the page tells a Team Report Manager their access to give reports is waiting for approval. The save-rule guard stays either way.

**#1217 depends on #1169 landing first**, and is rebased onto it then.

## Risks

- `reports_to` holding either id: both are matched; a value matching neither is no one.
- A manager with two current jobs: reports to either count.
