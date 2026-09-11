# Google sign-in setup

Northstar already contains the browser flow (`/sign-in` → Supabase OAuth → `/auth/callback`). Google sign-in becomes usable after the Supabase project is configured.

1. In Supabase Dashboard, open **Authentication → Providers → Google**, enable the provider, and paste the Google OAuth client ID and secret.
2. In **Authentication → URL Configuration**, set the Site URL to the URL where Northstar is running.
3. Add these exact redirect URLs:
   - `http://localhost:3000/auth/callback` for local development.
   - `http://127.0.0.1:3000/auth/callback` if using the loopback address.
   - `https://<your-production-host>/auth/callback` for production.
4. In Google Cloud Console, add the Supabase callback URL shown by Supabase (usually `https://<project-ref>.supabase.co/auth/v1/callback`) to the OAuth client's authorized redirect URIs.
5. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the app environment, then restart the dev server.

Set `NEXT_PUBLIC_AUTH_ORIGINS` to a comma-separated list of exact app origins in staging and production (for example, `https://app.example.com`). Each value must be a clean `http://` or `https://` origin without a path, query, fragment, credentials, or wildcard. The sign-in page constructs only `/auth/callback` and `/auth/recovery` from this allowlist; a browser origin outside it is rejected before Supabase is called. Development defaults to `http://localhost:3000` and `http://127.0.0.1:3000` when the variable is omitted.

The app does not receive or store Google passwords. Supabase handles the OAuth exchange and session. If the provider is disabled or a redirect is missing, the sign-in page shows the provider error and the callback page offers a recovery link.

## Local verification

After configuration, open `/sign-in`, select **Continue with Google**, complete consent, and verify that the browser lands on `/dashboard` with the authenticated account. Also test a denied consent and an invalid callback to confirm the error path.
