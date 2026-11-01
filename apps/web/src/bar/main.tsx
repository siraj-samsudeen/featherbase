// The bar bundle's entry (#650), served as /featherbase/bar.js and loaded by
// an installed app's entry document (apps/server/src/runtime-shell.ts).
import { mountBar } from './mount'
import { FeatherbaseSidebar } from './sidebar'

class FeatherbaseBar extends HTMLElement {
  connectedCallback() {
    if (!this.shadowRoot) mountBar(this)
  }
}

if (!customElements.get('featherbase-bar')) customElements.define('featherbase-bar', FeatherbaseBar)
// Upgrade the bar first: a sidebar already present in the app's HTML can
// immediately follow its theme, before React renders the bar's controls.
if (!customElements.get('featherbase-sidebar')) customElements.define('featherbase-sidebar', FeatherbaseSidebar)
