'use strict';

// The sign-in form.
class LoginPage {
  constructor(page) {
    this.page = page;
  }

  async signIn(user, password) {
    await this.page.goto('/login');
    await this.page.fill('input[name=email]', user);
    await this.page.fill('input[name=password]', password);
    await this.page.getByTestId('login-submit').click();
    await this.page.waitForURL(/\/admin/);
  }
}

module.exports = { LoginPage };
