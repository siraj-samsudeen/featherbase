# Proposal

## Why

Featherbase is about to make its first real production move, and the owner's
rule for it is *no backward compatibility*: start clean, wipe out bad
decisions. The account table carries three of them. It is called `user`,
though from the next phase most rows will be people who never use the system;
scripts (service accounts) live in it as if they were people, which forces
"service account ⇒ refused" special cases into sign-in, identifiers and
merging; and most ids are employee codes or email addresses, which change and
collide (28 StyleHR codes collide across firms), so they cannot be the
permanent reference that reports and every `owner` column rely on.

`person-resolution` (one person, many identifiers) needs all three fixed
first. Doing them in their own change keeps the structural rename reviewable
on its own and gives `person-resolution` a clean base. Prod is platform-only;
dev holds ~280 trial accounts that are migrated once as data.

## What Changes

- **The human's record is a Person.** The `user` table, the Admin form and the
  API paths are renamed; every reference to a person follows.
- **Automation accounts are their own kind of principal.** A service account
  moves out of the person table into its own, keeping its tokens, roles, data
  access and shares exactly as today. Tokens, roles, data access and shares
  refer to *a principal* — a person or a service account — through one model.
- **Every person gets an opaque permanent id**, including dev's trial
  accounts, which are re-keyed once in one transaction with a check that no
  old id survives in any place that refers to a person (codes and free text
  are left alone). Administrator and Guest keep their ids. Sessions end at
  deploy; tokens keep working.
- **One rehearsed release together with the first slice of
  `person-resolution`**, inside a maintenance window; the roster sync stays
  frozen until the warehouse rebuilds it, and leavers are disabled by hand
  meanwhile.
- **The sign-in table is renamed** `sign_in_identity`, so "identity" (signs
  in) and "identifier" (does not) are never confused once
  `person-resolution` adds identifiers.
- **BREAKING (internal, by design):** `/api/users/…` → `/api/people/…`;
  the CDC's `access.user` is dropped and `access.person` snapshotted; the
  warehouse models that read `access.user` are repointed in the same release.

## Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: an account's permanent reference is never an
  address or a code; who may sign in says automation accounts are not people.
- `access-tokens`: a service account is its own kind of account and keeps
  everything it has; a person's token and a service account's token behave
  alike.

## Impact

- `apps/server`: migration `0101_person_rename.ts` (rename, `service_account`,
  principal model, re-id by the handler registry, post-check); `permissions.ts`
  (`getRoles`, `isBypassUser` → `isPrivileged`), `auth.ts`, `index.ts` token
  routes, `service-accounts.ts`, `who(c)` and every `owner`/`created_by`
  writer, Reference pickers, Activity Log / Version / Comment / notification
  writers, `tenancy.ts` left as is.
- `apps/web`: "User" → "Person" everywhere a person is meant; the service
  account list.
- Outside the repo: CDC registration (`access.user` → `access.person`,
  `service_account` denied); warehouse models repointed (data-warehouse#4336).
- Stacked on `person-identities` (#371); `person-resolution` stacks on this.
