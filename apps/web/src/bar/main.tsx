// The bar bundle's entry (#650), served as /featherbase/bar.js and loaded by
// an installed app's entry document (apps/server/src/runtime-shell.ts).
import { mountBar } from './mount'

class FeatherbaseBar extends HTMLElement {
  connectedCallback() {
    if (!this.shadowRoot) mountBar(this)
  }
}

if (!customElements.get('featherbase-bar')) customElements.define('featherbase-bar', FeatherbaseBar)
