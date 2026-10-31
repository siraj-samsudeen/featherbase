'use strict';

// The signed-in person's account menu.
class AccountMenu {
  constructor(page) {
    this.page = page;
  }

  async signOut() {
    await this.page.getByTestId('session-user').click();
    await this.page.getByTestId('logout').click();
    await this.page.waitForURL(/\/login/);
  }
}

module.exports = { AccountMenu };
