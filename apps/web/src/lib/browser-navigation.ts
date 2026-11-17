// The browser's own navigation, as one boundary a component test can stand in
// for: jsdom cannot load another document, and `window.location` cannot be
// spied on. Code that must leave the app for another address calls this.
export const browserNavigation = {
  /** Load `url` in this tab (a full page load, possibly to another origin). */
  leaveFor(url: string): void {
    window.location.assign(url)
  },
}
