// Full page loads, behind one object so tests can watch them (jsdom does not
// navigate). #1255: switching account loads the page afresh, so nothing of the
// previous account's page or cache survives.
export const pageLoad = {
  assign: (path: string) => window.location.assign(path),
  reload: () => window.location.reload(),
}
