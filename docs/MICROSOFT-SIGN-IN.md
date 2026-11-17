# Setting up Sign in with Microsoft

Microsoft sign-in lets people sign in with a Microsoft work or school account
(Office 365, Microsoft Entra ID). Any organisation's account may *try*; who
gets in is Featherbase's rule (the `microsoft-sign-in` change):

- an account already linked to a person, by its permanent tenant + object ID;
- a person a System Manager marked **Expects Microsoft sign-in**, whose own
  address Microsoft confirms (its organisation has verified the domain) and
  whose domain is on the method's allowed list. Their first sign-in links the
  account for good;
- otherwise the method's rule for unknown people (refuse, in production).

The client id and tenant are instance settings. The client secret is only the
`MICROSOFT_CLIENT_SECRET` deployment variable: it is never committed, and it is
entered by the person registering the app.

## 1. Register the app (Microsoft Entra admin centre)

1. Go to <https://entra.microsoft.com> and sign in as an administrator of the
   tenant that will own the app (Bisquared's).
2. **Entra ID → App registrations → New registration.**
   - **Name:** `Featherbase` (people see it on Microsoft's consent screen).
   - **Supported account types:** the multitenant option for work and school
     accounts only ("Multiple Entra ID tenants" / "Accounts in any
     organizational directory"). **Not** the option that adds personal
     Microsoft accounts.
   - **Redirect URI:** platform **Web**, value
     `https://dash.jeyarama.com/api/oauth/microsoft/callback`.
   - **Register.**
3. **Authentication → Web → Redirect URIs → Add URI** for each other address
   that starts sign-in, exactly as below (scheme, host and path must match
   byte for byte; no trailing slash):
   - staging: `https://featherbase-staging.up.railway.app/api/oauth/microsoft/callback`
   - any other admin address the instance's `INSTANCE_ADDRESSES` names.
   Leave **Front-channel logout URL** empty and both **Implicit grant** boxes
   unticked. **Save.**
4. **API permissions.** Microsoft Graph → Delegated: `openid`, `profile`,
   `email` (`User.Read` is added by default and is harmless; it can be
   removed). No application permissions. Admin consent is not needed for
   these.
5. **Manifest** (the address claims Featherbase trusts). In the manifest
   editor, set `optionalClaims` to:

   ```json
   "optionalClaims": {
     "idToken": [
       { "name": "email", "essential": false },
       { "name": "xms_edov", "essential": false }
     ],
     "accessToken": [],
     "saml2Token": []
   }
   ```

   **Save.** `xms_edov` says whether the account's organisation has verified
   its email domain. Without it Featherbase keeps no address from Microsoft,
   so an expected person cannot be linked by address (an administrator can
   still link them by hand).
6. **Certificates & secrets → Client secrets → New client secret.** A
   description (`featherbase`) and the longest expiry offered. **Add**, then
   copy the **Value** (not the Secret ID) at once: it is shown only now.
   Put a reminder in the calendar a month before it expires.
7. From **Overview**, copy the **Application (client) ID**.

## 2. Give Featherbase the values

**The secret** (step 6): set `MICROSOFT_CLIENT_SECRET` on the deployment's
service (Railway → the service → Variables), on production and on staging
(one app registration serves both, so the value matches). Paste it there
yourself; it goes nowhere else.

**The client id** (step 7) and the domains: add the method to the instance
settings file (for Dash, `client-apps/jeyarama/instances/dash/instance-settings.json`).
In the base `Sign In Method` list:

```json
{
  "row_id": "microsoft",
  "kind": "microsoft",
  "label": "Microsoft",
  "enabled": true,
  "new_person": "refuse",
  "allowed_email_domains": "bisquared.com",
  "self_link": true,
  "settings": { "tenant": "organizations" }
}
```

and the client id in each environment that has the secret (`dev`/`prod`
sections), as Google's is:

```json
{ "row_id": "microsoft", "client_id": "<Application (client) ID>" }
```

Locally leave `client_id` empty: the development stand-in for Microsoft
serves (with `ALLOW_MOCK_OAUTH=1`). `settings.tenant` may name one tenant's
ID instead of `organizations` to admit only that organisation.

Deploy, then apply the settings (README, `settings:apply`). The release
preflight refuses a deploy where the method is on with a client id and
`MICROSOFT_CLIENT_SECRET` is missing.

## 3. Let a person in

1. Admin → Person → the person (their **Email** must be their Microsoft
   work address) → tick **Expects Microsoft sign-in** → Save. Only a System
   Manager can.
2. The person opens the sign-in page and chooses **Sign in with Microsoft**.
   The first sign-in links their Microsoft account; afterwards it opens their
   account whatever its address becomes.

A refused sign-in is explained on the sign-in page. "This Microsoft account
isn't set up" means one of: the person isn't marked, their address differs,
the domain isn't on the allowed list, or Microsoft didn't confirm the domain
(step 5).

## Rotating the secret

Make a new secret (step 6), set `MICROSOFT_CLIENT_SECRET` to it on every
environment, redeploy, sign in with Microsoft once, then delete the old
secret in Entra.
