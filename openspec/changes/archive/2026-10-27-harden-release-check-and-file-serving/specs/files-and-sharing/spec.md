## MODIFIED Requirements

### Requirement: An uploaded file never runs as part of Featherbase

A file SHALL open in place only when it is a kind the browser shows without
running anything, such as a picture, a PDF, plain text, or sound or video in a
common format. Any other file, a web page or a drawing that can carry script
among them, SHALL download instead.

#### Scenario: An uploaded web page

- **WHEN** someone uploads a web page and another user opens its link
- **THEN** the file downloads; nothing in it runs inside Featherbase

#### Scenario: A file whose declared kind hides a web page

- **WHEN** a file's declared kind lists plain text followed by a web page, at upload or edited later
- **THEN** the browser is told only the first, plain kind, so the file never opens as a page

#### Scenario: A picture still shows

- **WHEN** a user opens an uploaded photo or PDF
- **THEN** it shows in the browser as before

#### Scenario: A video in a common format plays

- **WHEN** a user opens an uploaded MP4 video or MP3 recording
- **THEN** it plays in the browser

#### Scenario: A file declared as an unusual kind of sound or video

- **WHEN** someone uploads a file declared as a kind of sound or video that is not a common format
- **THEN** the file downloads instead of opening
