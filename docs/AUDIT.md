# Repository audit and implementation plan

Audit date: 2026-09-12. Baseline: 23ed1b6244f49350ee218b65d57e1cfdd737e528.

## Existing architecture

- Next.js 16.2.9 App Router, React 19, TypeScript, Tailwind 4.
- pg connects to PostgreSQL; runtime CREATE TABLE statements initialize booking,
  schedule, invoice, pricing override, metrics and Telegram session tables.
- Development falls back to JSON files. Production requires DATABASE_URL.
- Authentication uses one environment-configured email/password and an HMAC cookie.
  There are no individual users, roles, session revocation or password resets.
- Booking APIs (/api/book and /api/bookings) validate with Zod, recompute prices,
  reserve times, then invoke email/SMS/Telegram. Service names are fixed unions.
- Services have database price overrides, but cannot be created, disabled or reordered.
- CRM profiles are reconstructed from bookings; there are no customer/vehicle/lead
  entities, consent records, attribution links or durable customer timelines.
- Stripe Checkout links exist, but customer returns point into admin and there is no
  verified payment webhook. Manually editable invoice status is not payment evidence.
- Resend, Twilio and Telegram are optional environment-configured integrations.
- Google Ads and Meta IDs are hardcoded. No attribution or revenue linkage exists.
- Dashboard revenue sums estimates, including unpaid bookings. Public reviews are
  unverified template content and must not be presented as West Loop customer reviews.
- Existing car photography can support the new visual identity; captions must not
  claim that it documents work by the new business.
- Build/start: next build / next start. No tests, lockfile or Railway config in baseline.
- No local production credentials or database connection are present.

## Implementation sequence

1. Establish an independent West Loop visual identity and audit trail on this branch.
2. Add a versioned relational schema in a dedicated wl namespace, preserving legacy
   tables. Use PostgreSQL in production and PGlite PostgreSQL locally for real SQL tests.
3. Replace public templates with concise pages, editable services, gallery and booking.
4. Add transactional booking/customer/vehicle/attribution creation and interval locking.
5. Implement role-protected CRM, calendar, leads, services, settings and reports.
6. Add durable notification outbox, editable email templates, consent-aware campaigns,
   signed payment/SMS webhooks and provider adapters.
7. Link first-party analytics and configurable ad tracking to saved bookings and payments.
8. Run database, security, journey and responsive tests; document provider setup gaps.

Initial services and prices are editable seed configuration, not business activity.
No customers, reviews, payments, leads or reporting figures are seeded.
