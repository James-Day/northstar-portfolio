# Northstar deployment architecture

Northstar has three environments with deliberately different responsibilities.

## Local development

Docker Desktop runs the Supabase CLI stack on the developer's machine. The
containers provide PostgreSQL, Auth, Storage, PostgREST, and Studio for
repeatable migrations and isolation tests. They are development dependencies;
they are not the production database and do not need to be exposed to the
internet.

The local frontend runs on `http://localhost:3000` and the Hono API Worker runs
on `http://127.0.0.1:8787`. Local Google OAuth uses the Supabase callback
`http://127.0.0.1:54321/auth/v1/callback`. Local secrets live in ignored
`.env*`, `.dev.vars`, and `supabase/.env` files.

## Staging

Staging uses a separate hosted Supabase project and a separate Cloudflare
deployment. Supabase Cloud owns the managed PostgreSQL database, Auth, private
Storage, backups, and recovery. Cloudflare hosts the frontend, Hono API Worker,
Queues, scheduled jobs, and Durable Objects.

Staging must use separate users, OAuth credentials, Stripe test mode, and
Marketstack development credentials. Never point staging at production tables
or production secrets. The staging deployment record must capture the Supabase
project, migration revision, Worker revision, queue names, configured origins,
and the results of the RLS, Storage, browser, queue, and report checks.

Until production launch, use the direct Cloudflare frontend Worker at
`https://sites-project.jamesoman332.workers.dev`. Do not use the managed
`chatgpt.site` deployment URL for development links or OAuth testing.

## Production

The recommended production topology is:

```text
Cloudflare Pages/Workers
  frontend + Hono API + Queues + cron + Durable Objects
             |
             v
Supabase Cloud
  Auth + PostgreSQL + private Storage + backups
```

The frontend reads only the public Supabase URL and publishable/anonymous key.
The API Worker holds the Supabase service-role key, Stripe secret, and
Marketstack key in Cloudflare's encrypted secret store. Provider credentials
must never be placed in `NEXT_PUBLIC_*` variables or browser bundles.

Production Google OAuth uses the hosted Supabase callback shown in the
Supabase dashboard (normally `https://<project-ref>.supabase.co/auth/v1/callback`)
and the application's exact HTTPS callback origin. Stripe webhooks and the
Northstar API use the production HTTPS domain. The local loopback callback is
not valid for production.

## Why not run the Docker containers in production?

Self-hosting Supabase with Docker is possible, but it makes Northstar
responsible for PostgreSQL upgrades, backups, Storage durability, Auth
availability, monitoring, and recovery. The MVP uses managed Supabase so the
team can focus on portfolio correctness and keep a separate staging project
without operating a database cluster.

Vercel can host the frontend, but it would add another deployment platform
alongside the existing Cloudflare Worker, Queues, and scheduled jobs. Cloudflare
keeps the application edge and background execution in one operational surface.

## Deployment order

1. Create separate Supabase staging and production projects.
2. Apply migrations and verify RLS, private Storage, Auth redirects, and backup
   settings in staging.
3. Deploy the API Worker, queues, Durable Objects, and secrets to staging.
4. Deploy the frontend with the staging public Supabase configuration.
5. Run the authenticated import, report, billing, retention, deletion, and
   rollback checks from `docs/LAUNCH_RUNBOOK.md`.
6. Record revisions and evidence, then repeat the process for production with
   production credentials and the approved commercial market-data plan.
