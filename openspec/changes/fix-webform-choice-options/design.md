# Design

## Context

See proposal.md for motivation. The server currently projects a Table's
whitelisted column metadata into a public WebForm configuration but omits the
newline-separated choice metadata. The React renderer therefore knows a field
is a Choice but cannot render its options. Submission already uses the normal
save lifecycle, which validates Choice values against the same metadata.

## Goals / Non-Goals

**Goals:**

- Keep one shared TypeScript contract for the server response and client use.
- Preserve the exact configured option values, labels, and order from Table
  metadata through rendering and submission.
- Keep invalid-value rejection in the existing server validation path.

**Non-Goals:**

- Changing how Table choices are stored, parsed, or validated.
- Changing generic forms or other field types.
- Adding client-side choice validation as a second source of truth.

## Decisions

### Carry the existing metadata string across the WebForm contract

The WebForm column will expose `choices` as the same nullable,
newline-separated string held by Table metadata. The server can project it
without transforming it, and the client can split, trim, and omit blank lines
in the same way existing metadata consumers do. This preserves order and
avoids defining a WebForm-specific option representation.

An array of `{ value, label }` objects was considered, but Table choices do not
have separate values and labels. Introducing that shape would add a second
representation and imply a distinction the source metadata does not contain.

### Share the public WebForm wire type

The contract will live in `packages/shared` and both server and web will import
it. Extending the two current local interfaces independently was rejected
because the omission came from those duplicate shapes drifting together.

### Leave submission validation unchanged

The browser submits the selected string exactly as it does other answers. The
existing save lifecycle remains responsible for accepting configured choices
and rejecting every other value, so the Table metadata remains the sole source
of truth.

## Risks / Trade-offs

- [Whitespace or blank lines in stored metadata] → Parse options with the
  established trim-and-filter behavior while retaining the order of remaining
  options.
- [A caller can still forge an invalid value] → Keep the existing server save
  validation and prove its rejection in the focused server integration test.
