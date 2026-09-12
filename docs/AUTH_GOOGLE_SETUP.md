# Google sign-in setup

Northstar already contains the browser flow (`/sign-in` → Supabase OAuth → `/auth/callback`). The sign-in page sends only the public Supabase URL and anonymous key to the browser; Google client secrets stay in Supabase Auth. Google sign-in becomes usable after the Supabase project is configured.

1. In Supabase Dashboard, open **Authentication → Providers → Google**, enable the provider, and paste the Google OAuth client ID and secret.
2. In **Authentication → URL Configuration**, set the Site URL to the URL where Northstar is running.
3. Add these exact redirect URLs:
   - `http://localhost:3000/auth/callback` for local development.
   - `http://127.0.0.1:3000/auth/callback` if using the loopback address.
   - `https://<your-production-host>/auth/callback` for production.
4. In Google Cloud Console, add the Supabase callback URL shown by Supabase (usually `https://<project-ref>.supabase.co/auth/v1/callback`) to the OAuth client's authorized redirect URIs.
5. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the app environment, then restart the dev server.

The browser only needs the Supabase project URL and anonymous key. Never put the
Google client secret, Supabase service-role key, or any other server secret in
`NEXT_PUBLIC_*` variables. Set `NEXT_PUBLIC_AUTH_ORIGINS` to the exact origin(s)
that may receive the callback (comma-separated for more than one origin), such
as `https://app.example.com`. Do not include `/auth/callback`, a trailing path,
wildcards, or query strings. If this variable is missing in production, auth
redirects fail closed instead of redirecting to an unapproved site.

## Local Supabase

The checked-in `supabase/config.toml` includes a disabled Google provider block so a fresh `npx supabase start` remains deterministic. To test the real Google flow locally:

1. Create a Web OAuth client in Google Cloud Console.
2. Add the local Supabase callback URL (`http://127.0.0.1:54321/auth/v1/callback`) to its authorized redirect URIs.
3. Put the client ID and secret in your local secret environment as `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`.
4. Change `[auth.external.google]` `enabled` to `true` in your local copy of `supabase/config.toml`, then restart Supabase.
5. Run the app with the public local Supabase URL and anonymous key printed by `npx supabase status`.

Do not commit the edited local config or OAuth secret. The default local integration harness uses email/password fixtures and does not require Google credentials.

Set `NEXT_PUBLIC_AUTH_ORIGINS` to a comma-separated list of exact app origins in staging and production (for example, `https://app.example.com`). Each value must be a clean `http://` or `https://` origin without a path, query, fragment, credentials, or wildcard. The sign-in page constructs only `/auth/callback` and `/auth/recovery` from this allowlist; a browser origin outside it is rejected before Supabase is called. Development defaults to `http://localhost:3000` and `http://127.0.0.1:3000` when the variable is omitted.

The app does not receive or store Google passwords. Supabase handles the OAuth
exchange and session. The callback page waits for the browser Supabase client to
finish exchanging the authorization code, then sends the resulting access token
to the server session endpoint. The server verifies that token before issuing
the private workspace cookie. If the provider is disabled, consent is denied,
or a redirect is missing, the sign-in page shows a retryable error and the
callback page offers a recovery link. OAuth error descriptions are bounded
before they are displayed.

## Local verification

After configuration, open `/sign-in`, select **Continue with Google**, complete consent, and verify that the browser lands on `/dashboard` with the authenticated account. Also test a denied consent and an invalid callback to confirm the error path.
