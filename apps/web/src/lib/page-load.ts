// Full page loads, behind one object so tests can watch them (jsdom does not
// navigate). #1255: switching account loads the page afresh, so nothing of the
// previous account's page or cache survives.
export const pageLoad = {
  assign: /* istanbul ignore next -- jsdom does not navigate; every caller's test spies on this */ (path: string) => window.location.assign(path),
  reload: /* istanbul ignore next -- as above */ () => window.location.reload(),
}
