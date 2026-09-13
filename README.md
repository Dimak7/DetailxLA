# West Loop Auto Spa

Premium Chicago automotive care website and a relational business workspace. This release is for the DetailxLA repository and its separate Railway service, not the original Chicago application.

## Run locally
Use Node 24 and pnpm 11.19.0.
```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```
Development uses embedded PostgreSQL (PGlite) persisted under ignored `data/west-loop.pg`. Production requires a dedicated PostgreSQL `DATABASE_URL`; there is no ephemeral JSON fallback. Test databases are isolated in memory and contain synthetic records only.

## Railway
Connect the existing DetailxLA service to `Dimak7/DetailxLA`, branch `main`. The checked-in Dockerfile builds the application and applies idempotent schema initialization before starting Next.js on Railway's PORT. Health check: `/api/health`.

Required variables: `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12+ characters), `ADMIN_SESSION_SECRET` (random 32+ characters), `SETTINGS_ENCRYPTION_KEY` (random 32+ characters). Use the generated Railway URL until a domain is connected. Do not reuse the Chicago database or notification destinations without reviewing them.

For scheduled reminders/campaigns, add a worker service from the same repo, with the same environment and database, and override its start command to `pnpm worker`. Disable the HTTP health check on that worker. Alternatively invoke POST `/api/jobs` with a Bearer `CRON_SECRET` from a trusted scheduler. Immediate booking notifications are also processed after the booking response.

## Before launch
1. Sign in at `/admin/login` using the initial owner configuration.
2. Review services, prices, opening days, hours, buffers, appointment location, business contact details, cancellation policy and any deposit.
3. Configure provider credentials in Settings or through the documented environment variables. Database-saved credentials use AES-256-GCM; never rotate the encryption key without re-encrypting saved settings.
4. Verify each connected provider with a controlled real delivery. Configured is not the same as verified.
5. Upload authorized work photos and publish genuine reviews. No customers, reviews, revenue or ad metrics are fabricated.
6. Have the business review its privacy notice, consent wording and service terms for its actual operations.

## Integrations
- Email: Resend; set a verified sender and API key. Transactional templates are editable.
- SMS: Twilio. Configure inbound and delivery webhooks at `/api/webhooks/sms`. Requests require a valid Twilio signature. STOP suppresses messages to the opted-out phone; marketing also requires affirmative consent.
- Telegram: bot token, chat ID and webhook secret. Register `/api/telegram` with Telegram's secret_token. /today and /tomorrow show schedules; private admin links open authenticated management.
- Payments: Stripe Checkout. Register `/api/webhooks/stripe` for checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired and charge.refunded. Raw-body signature verification, invoice amount matching and event deduplication protect payment state.
- Google/Meta: configurable browser tags and Meta server events. Purchase events require verified payment. Google/Meta ad account reporting APIs are not connected; the dashboard explicitly distinguishes unknown spend and allows manual verified spend entries.

## Operations & scope
Schema `wl` isolates the new platform from legacy tables. Legacy customer data is not imported automatically. Back up PostgreSQL and uploaded media before deployment. New services and business settings are seeded only as editable starting points.

Appointments reserve one shared service lane, including duration and buffer. Schedule mutations use a database row lock to prevent concurrent overlapping bookings across instances. Staff can see/update only their assigned bookings and cannot access financial or marketing reports.

Outbox delivery states include queued, sent, failed, skipped, cancelled and uncertain. Timeouts are not blindly retried, to avoid duplicate SMS. Check provider logs before resolving an uncertain delivery. Missing integrations are recorded honestly and do not undo successful bookings.

Revenue is net verified payment revenue, not booked estimates. Lifetime customer spend uses the same payment ledger. Phone clicks are not answered calls. Attribution is first-touch within a browser session; manual lead-to-booking conversion retains the lead source. Consent choices and customer activity have separate audit histories.

Production payment collection, live message delivery and external advertising account reporting require business-owned credentials and provider setup. No external campaign is sent merely by deploying this code.
