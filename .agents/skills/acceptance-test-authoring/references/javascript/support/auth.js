'use strict';

// People start a scenario already signed in: their session comes from the
// API, so the sign-in form is typed only in scenarios about signing in.
// Setup (records, roles, people) goes through one API session per run;
// what a scenario then does and checks goes through the browser.
// Lines marked PROJECT: are the ones each project fills in.

const { request } = require('playwright');
const { API_URL, BASE_URL } = require('./stack');

// PROJECT: the seeded administrator of a fresh acceptance database.
const ADMIN = { user: process.env.ACCEPTANCE_ADMIN_USER ?? 'admin', password: process.env.ACCEPTANCE_ADMIN_PASSWORD ?? 'admin' };

/**
 * A Playwright storageState for a new browser context, signed in as this
 * person without the form. Make the same request the sign-in form makes,
 * through the web app's address so the session cookie lands there.
 */
async function signedInState(user, password) {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  try {
    // PROJECT: the sign-in form's request.
    const res = await ctx.post('/api/login', { data: { user, password } });
    if (!res.ok()) throw new Error(`sign-in as ${user} failed: ${res.status()} ${await res.text()}`);
    // PROJECT: if the app also writes something to localStorage after a sign-in
    // (a token, the current user), add it here under origins[].localStorage.
    return await ctx.storageState();
  } finally {
    await ctx.dispose();
  }
}

let adminApi = null; // one API session per run, opened on first use

/** The run's API session as the administrator. */
function api() {
  adminApi ??= (async () => {
    const ctx = await request.newContext({ baseURL: API_URL });
    // PROJECT: sign in for API calls (a cookie is kept by ctx; for a bearer
    // token, return request.newContext({ baseURL, extraHTTPHeaders }) instead).
    const res = await ctx.post('/api/login', { data: { user: ADMIN.user, password: ADMIN.password } });
    if (!res.ok()) throw new Error(`API sign-in failed: ${res.status()} ${await res.text()}`);
    return ctx;
  })();
  return adminApi;
}

/** Ends the run's API session, if one was opened. */
async function disposeApi() {
  const ctx = await adminApi?.catch(() => null);
  adminApi = null;
  await ctx?.dispose();
}

module.exports = { ADMIN, api, disposeApi, signedInState };
