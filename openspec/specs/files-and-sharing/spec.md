# Files and Sharing

## Purpose

A file the user uploads is a row in its own right, not just something
attached to a form, so it can be found and managed on its own, kept private
or opened to anyone with its link, and a row can be opened to one more
person without changing what that person can normally see.

## Requirements

### Requirement: Find and manage a file on its own

The user SHALL be able to find, open and remove an uploaded file directly,
not only from the row it was attached from.

#### Scenario: Find a file outside its row

- **WHEN** the user looks through the list of uploaded files rather than
  opening the row a photo was attached to
- **THEN** the photo is there, with the row it belongs to

### Requirement: A file is public or private

Uploading a file SHALL let it be marked private. A public file opens for
anyone with its link; a private one SHALL require the same access as
whatever it's attached to before it opens.

#### Scenario: A private file needs access to open

- **WHEN** a user without access to a row tries to open a private file
  attached to it
- **THEN** opening it is refused

#### Scenario: A public file opens freely

- **WHEN** anyone follows a public file's link
- **THEN** it opens without needing to sign in

### Requirement: A private file opens through a short-lived link

Opening a private file SHALL check the viewer's access at that moment and
hand back a link that keeps working on its own, without asking them to sign
in again, only for a short time. Once handed out, that link keeps working
until it expires even if the viewer's access to the file is taken away in
the meantime.

#### Scenario: A link outlives a revoked share

- **WHEN** a user opens a private file while they still have access, and
  that access is removed moments later
- **THEN** the link they already have keeps working until it expires

### Requirement: Share a row with one more person

The user SHALL be able to give one more person view, edit, or reshare
access to a single row, without changing anything about that person's
normal role. Taking that access away SHALL remove it immediately.

#### Scenario: Share a row for viewing only

- **WHEN** the user shares a row with a colleague for viewing only
- **THEN** the colleague can open it
- **AND** the colleague cannot edit it

#### Scenario: Removing a share takes effect at once

- **WHEN** the user removes a share they had granted
- **THEN** the person it was shared with can no longer open that row

### Requirement: Attachments and shares protect a row from deletion

In an installed app, a row that still has a file attached or is shared with
someone SHALL NOT be deleted until those are removed first.

#### Scenario: A shared row resists deletion

- **WHEN** a user tries to delete a row of an installed app that is still
  shared with a colleague
- **THEN** the deletion is refused
