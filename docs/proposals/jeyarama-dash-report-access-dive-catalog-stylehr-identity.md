# Jeyarama Dash — governed Dive catalogue and unambiguous employee report access

**Status:** implementation specification; no production permission changes in this PR.  
**Target:** https://dash.jeyarama.com/dash/?view=access (Report Access tab)  
**Business coordinator:** Sebronia Cross Zita  
**Target instance:** `jeyarama/dash`  
**Requested:** 16 Nov 2026

## Problem
1. Report Access must present a **complete, current catalogue** of MotherDuck Dives, including newly created and subsequently edited Dives, so Sebronia can assign the correct report to its intended employees.
2. Searching staff by name alone is ambiguous; identical names can cause reports to be granted to the wrong person.

## Functional requirements
### Catalogue
- Source the list from the authoritative MotherDuck Dive catalogue/API or a governed replicated table. Do not infer the catalogue from previously assigned reports or a hard-coded list.
- Show **all authorised Dives** in Report Access with canonical stable `dive_id`, title, URL, status, owner, last-modified timestamp and sync timestamp. Search, filter and paginate; show total and freshness/error states.
- On editing a Dive, preserve its stable identity/assignment where it remains the same object; refresh metadata and title. New Dives become assignable after sync. Deactivated/deleted Dives must not remain actionable. Do not silently grant newly created Dives to anyone.
- Explicitly distinguish *catalogue visibility to admins* from *recipient view permissions*.

### StyleHR identity
- Search by **employee name OR StyleHR employee ID**; show `Full Name — StyleHR ID — Store/Department — Employment Status` in every suggestion. Use HR master data as the canonical source.
- Select and persist the **immutable employee identity / StyleHR ID**, not display name; disambiguate same names. No auto-select on partial match; require explicit selection.
- Include employee ID alongside name in existing grant lists, audit history and review/confirmation dialogs. Reject unknown, stale, inactive or ambiguous personnel subject to documented policy.
- If a StyleHR ID is not globally unique across entities, use a scoped composite key (entity + employee ID) or the HR system's global stable person key.

### Grant workflow and safeguards
- Sebronia can choose a specific Dive, select the intended employee (including ID), choose access level, review the exact pair, then save.
- Backend validates actor authorization, target identity, Dive existence and permitted scope; enforce least privilege server-side. Avoid exposing confidential report metadata to unauthorized users.
- Idempotent create/update and revoke; preserve existing valid grants during backfill. No bulk or automatic grants to employees.
- Append-only audit details: actor, timestamp, selected employee stable ID, employee name snapshot, Dive ID/title snapshot, permission, action, previous/new state and result.
- Fail closed if HR identity resolution or Dive catalogue freshness is insufficient; show actionable error instead of assigning to a possible wrong person.
- Consider role/department/store and separation-of-duties rules; never assume that listing a Dive authorizes assignment.

## Implementation work (remaining)
1. Locate Jeyarama Dash application implementation / `Report Access` component and its backend. Confirm authoritative Dive list and StyleHR source, API scopes and ownership.
2. Implement paginated catalog sync and deterministic merge/upsert keyed by Dive ID; stale/deleted status handling and a documented sync SLA.
3. Implement HR-backed employee search and persistence keyed by stable HR identity, with display label showing StyleHR ID and organizational context.
4. Implement safe access grant/revoke APIs with authorization, idempotency, and audit trails, plus migration of name-based grants using manual review for collisions.
5. Add UI loading/empty/error states, permission preview and audit view.

## Acceptance criteria / tests
- All currently available authorised Dives appear, including a newly created Dive after sync and a renamed/edited Dive without duplicate or grant loss.
- Two employees with the **same name** but different StyleHR IDs appear as distinct options. Selecting one cannot grant the other access.
- Searching an exact StyleHR ID yields the correct employee with entity/store/department context.
- User selection and grant persistence survive page refresh and concurrent search; backend never resolves identity from name alone.
- Inactive, missing or colliding HR identities fail safely; legacy name-only grants are quarantined for review, not guessed.
- Non-admin cannot enumerate restricted Dives or create grants via direct API; unauthorized requests are denied and logged.
- Concurrent grant operations are idempotent; revoke works; edit/rename does not alter existing grants.
- Sync lag and failures visible; audit records contain who, what, to whom and when.
- Regression tests cover pagination, API failure, duplicate names, stale data, privilege escalation and migration.

## Release controls
**Read-only discovery → test environment → review by Sebronia / data-security owner → staging UAT → approved production deployment.** Confirm MotherDuck and StyleHR permissions, production data classification and report-level access controls before go-live.

## Explicit non-goals for this proposal
No live report access granted, revoked, or modified. This change is a specification only until the correct Dash source and integrations are verified.
