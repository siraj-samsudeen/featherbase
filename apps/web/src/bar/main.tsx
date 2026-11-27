// The bar bundle's entry (#650), served as /featherbase/bar.js and loaded by
// an installed app's entry document (apps/server/src/runtime-shell.ts).
import { mountBar } from './mount'
import { FeatherbaseSidebar } from './sidebar'
import { installDeployWait } from '../lib/deploy-wait'
import { installStandInMark } from '../lib/stand-in-mark'

// #1260: every app page loads this bundle, so an app's own requests wait
// out a deploy too, without the app changing.
installDeployWait(window, document)
// #1409: and an app's own reads that carried stand-in rows are remembered, so
// the bar says the page shows sample data, without the app changing.
installStandInMark(window)

class FeatherbaseBar extends HTMLElement {
  connectedCallback() {
    if (!this.shadowRoot) mountBar(this)
  }
}

if (!customElements.get('featherbase-bar')) customElements.define('featherbase-bar', FeatherbaseBar)
// Upgrade the bar first: a sidebar already present in the app's HTML can
// immediately follow its theme, before React renders the bar's controls.
if (!customElements.get('featherbase-sidebar')) customElements.define('featherbase-sidebar', FeatherbaseSidebar)
