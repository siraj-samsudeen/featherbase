# zones.csv — claims

The agreement fixture of `docs/design/requirements-framework.md` (Part II).
Eight rows, six columns, each column landing on a different inferred type
without a judgement call:

- **Zone Name** → Data — eight distinct values; too varied to be a category
- **Region** → Choice (North, South) — two values ×4; repetition reads as a category (IMP-R3)
- **Population** → Int · **Area Sq Km** → Float (IMP-R2 #2/#3)
- **Opened On** → Date — same calendar day in every server timezone (IMP-R2 #4)
- **Is Active** → Check — clears the Choice bar exactly as Region does; stays a
  tick box only because the yes/no test runs first (IMP-R2.7, the ordering guard)

Deliberately benign: no leading-zero codes, no 16-digit ids, no 70-char
headers. Coverage of the hostile space lives in the rules' property tests,
not in this file.
