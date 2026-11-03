## Why

Email Sink messages currently look like database records rather than emails. People need to read the captured message without mistaking local capture for external delivery (#834).

## What Changes

- Add a small metadata-driven reading presentation to the generic row form.
- Configure Email Sink with subject, sender, recipient, recorded time, plain-text body and attachment names.
- Keep raw values secondary and read-only, and preserve existing authorization.

## Capabilities

### New Capabilities
- `captured-email-reading`: Read locally captured messages as emails, safely.

### Modified Capabilities
None.

## Impact

Table metadata, a forward migration, the generic form, executable acceptance scenarios and HTTP/component tests. No sending features, HTML interpretation, new endpoint, attachment downloads or message migration. Existing editable forms remain unchanged.
