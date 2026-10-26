# Files and Sharing

## Purpose

A file the user uploads is a row in its own right, not just something
attached to a form, so it can be found and managed on its own, and kept
private or opened to anyone with its link.

## Requirements

### Requirement: Find and manage a file on its own

The user SHALL be able to find, open and remove an uploaded file directly,
not only from the row it was attached from.

#### Scenario: Find a file outside its row

- **WHEN** the user looks through the list of uploaded files rather than
  opening the row a photo was attached to
- **THEN** the photo is there, with the row it belongs to

### Requirement: Removing a file removes its content

Removing an uploaded file SHALL also remove what was stored, so nothing is
left behind and its link stops working.

#### Scenario: A removed file's link stops working

- **WHEN** the user removes one of two files attached to a row
- **THEN** that file's link no longer opens
- **AND** the other file still opens

### Requirement: Attach only to what you can read

A file SHALL only be attached to a row, or to a table, that the uploader can
read, and a refused upload stores nothing.

#### Scenario: Attaching to a row the user can't see

- **WHEN** a user with no access to a row tries to upload a file attached to it
- **THEN** the upload is refused and no file is stored

### Requirement: Pictures get a small preview

An uploaded picture SHALL come with a small preview that lists and attachment
panels show instead of loading the full-size original. Other kinds of file
get none.

#### Scenario: A picture and a document

- **WHEN** the user uploads a wide photo and a text document
- **THEN** the photo has a small preview no larger than a thumbnail, with its
  proportions kept
- **AND** the document has no preview

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

### Requirement: An uploaded file never runs as part of Featherbase

A file SHALL open in place only when it is a kind the browser shows without
running anything, such as a picture, a PDF or plain text. Any other file, a
web page or a drawing that can carry script among them, SHALL download
instead.

#### Scenario: An uploaded web page

- **WHEN** someone uploads a web page and another user opens its link
- **THEN** the file downloads; nothing in it runs inside Featherbase

#### Scenario: A picture still shows

- **WHEN** a user opens an uploaded photo or PDF
- **THEN** it shows in the browser as before

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
