// #393: the privacy notice RB approved on 22-Oct-2026, corrected 23-Oct to
// match what the system does (Google account ID; no sign-in IP is recorded;
// leavers are disabled by hand until the roster sync), served at /privacy.
// Every statement must stay true of the running system — change the wording
// only with a fresh approval, and revise it when identifiers such as Aadhaar
// or phone start being held (person-resolution 1b).
export const privacyNoticeHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feather Dash: Privacy notice</title>
<style>
  :root { --bg: #fbfaf7; --fg: #1f2328; --muted: #5b6168; --rule: #dcd8cf; --head: #f0ede6; color-scheme: light dark }
  @media (prefers-color-scheme: dark) { :root { --bg: #16181b; --fg: #e8e6e1; --muted: #a3a8ae; --rule: #33373c; --head: #22252a } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif }
  main { max-width: 44rem; margin: 0 auto; padding: 2.5rem max(16px, env(safe-area-inset-left)) 3rem }
  h1 { font-size: 1.75rem; line-height: 1.25; margin: 0 0 .25rem }
  h2 { font-size: 1.15rem; margin: 2rem 0 .5rem }
  .effective { color: var(--muted); margin: 0 0 1.5rem }
  table { width: 100%; border-collapse: collapse; margin: .5rem 0 }
  th, td { text-align: left; vertical-align: top; padding: .5rem .75rem; border: 1px solid var(--rule) }
  th { background: var(--head) }
  a { color: inherit }
</style>
</head>
<body>
<main>
<h1>Feather Dash: Privacy notice</h1>
<p class="effective">Effective 22-Oct-2026</p>
<p><b>Feather Dash</b> is the internal operations and reporting system of <b>Jeyarama Retail Business Group</b>. Only employees and authorised staff use it. It is not a public or customer-facing service.</p>

<h2>What we hold about you</h2>
<table>
<tr><th>Information</th><th>Why</th></tr>
<tr><td>Your name and employee code</td><td>to identify you and show you your own work</td></tr>
<tr><td>Your StyleHR user ID</td><td>to let you sign in with your StyleHR details</td></tr>
<tr><td>Your work email address and Google account ID (if you sign in with Google)</td><td>to identify you; Google shares only your name, email address and account ID with us</td></tr>
<tr><td>Your store, sections and role (e.g. Team Leader, Store Manager)</td><td>to show you the reports and records that belong to you</td></tr>
<tr><td>A record of each sign-in: time and sign-in method</td><td>security and troubleshooting</td></tr>
</table>

<h2>What we do not hold</h2>
<ul>
<li><b>Your StyleHR password.</b> It is passed to StyleHR once, over an encrypted connection, to check it, and is never stored or logged by Feather Dash.</li>
<li><b>Your Google password.</b> Google checks it; we never see it.</li>
<li>Anything about you from outside the company.</li>
</ul>

<h2>Where the information comes from</h2>
<p>From the company's HR records (StyleHR and HR's staff files), and from what you or an authorised manager enter in Feather Dash.</p>

<h2>Who can see it</h2>
<ul>
<li>You can see your own details.</li>
<li>Your managers see what their role covers: a Store Manager for their store, a DM for their sections.</li>
<li>A small number of system administrators, for support.</li>
<li>The information is copied into the company's data warehouse for reporting.</li>
</ul>
<p>It is <b>never sold or shared</b> with anyone outside the company, other than the service providers that host the system for us:</p>
<ul>
<li><b>Railway</b>, for the application and database, hosted in <b>Singapore</b>.</li>
<li><b>MotherDuck</b>, for the data warehouse, hosted in the <b>United States</b>.</li>
</ul>

<h2>When access ends</h2>
<p>Your access follows the company's HR records. When you leave the company, your Feather Dash account is disabled, which ends every way of signing in, including Google. Sign-in with your StyleHR details also stops as soon as HR marks you as having left in StyleHR, and Google sign-in stops when your company Google account is closed.</p>

<h2>Questions or corrections</h2>
<p>If something about you is wrong, or you have a question about your information, contact <b><a href="mailto:siraj@jeyarama.com">siraj@jeyarama.com</a></b> or your HR team.</p>
</main>
</body>
</html>
`
