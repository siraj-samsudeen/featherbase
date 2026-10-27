# Proposal

## Why

Go-live puts real store staff on one instance, each with their own access. Several paths still show a person data their access doesn't cover: comments and history on rows they can't open, sensitive columns on the lines inside a row, scheduled report emails, and webhooks and email rules. Each one quietly undoes a permission an administrator set.

## What Changes

- A row's comments and history are seen only by people who can read that row, whatever they may do with comments elsewhere (#342).
- A sensitive column on the lines inside a row is hidden from a reader who can't see the row's sensitive columns, and a save never hands back what a read would hide (#341).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `comments-and-history`: comments and history follow the row's access.
- `permissions-and-roles`: sensitive columns stay hidden on a row's lines and in what a save returns.

## Impact

Server read paths for rows, comments and history; the Admin comment and activity panels read through the row's activity.
