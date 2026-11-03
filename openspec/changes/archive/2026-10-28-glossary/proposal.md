# Proposal

## Why

Every app brings words its users must learn: in a store app, "section owner",
"coverage" or "acting"; in a ticketing app, "triage". Today those meanings
live in repository documents that the people using the app never see (#629).

## What Changes

- A glossary: one searchable place for the words an instance's apps use, with
  a definition, examples, words to avoid and the Tables and columns each word
  describes.
- An app ships its terms with its package, so they upgrade with the app. An
  instance may add its own terms and reword an app's; an upgrade never
  overwrites a local wording, and says when the app's own wording changed.
- A small help mark beside a Table name or a form field that a term
  describes opens the term in place.
- An app whose term describes a Table or column it does not own is refused.

## Impact

- New capability `glossary`.
- A new platform Table for the terms (migration 0138), readable by everyone
  signed in; editing it is a write grant, which System Managers always have.
- A new, versioned manifest extension point for an app's terms.
- Admin gets a Glossary page and the help mark on list and form pages.
