'use strict';

// One row's form.
class FormPage {
  constructor(page) {
    this.page = page;
  }

  /** Whether the open form shows a field with this label. */
  async showsField(label) {
    const form = this.page.getByTestId('form-view');
    await form.waitFor();
    return (await form.getByLabel(label, { exact: true }).count()) > 0;
  }
}

module.exports = { FormPage };
