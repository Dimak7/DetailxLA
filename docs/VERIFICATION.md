# Release verification

Local verification on September 12, 2026:
- Next.js optimized production build succeeds, including all public pages and authenticated admin routes.
- TypeScript compilation succeeds.
- Eleven checks in the relational integration suite pass on an isolated PostgreSQL-compatible PGlite database.
- Automated checks cover linked customer/vehicle/lead/booking/outbox creation, idempotent retries, overlapping appointments, unavailable services, invalid dates, staff permissions, all admin data queries, signed Stripe payment evidence, duplicate webhooks, refunds, campaign consent, STOP suppression, missing provider logs, encrypted settings and one-use password resets.
- Browser QA: public homepage visually inspected on desktop; guided booking completed in a 390px mobile viewport with synthetic local-only details. Confirmation shows an unpaid reservation accurately.
- Browser QA: owner login succeeds; dashboard contains the new booking, customer, lead and funnel events with zero payment revenue.
- No business-owned payment/email/SMS/Telegram/advertising credentials were used for these tests. Live provider delivery still needs configuration and a controlled production test.
- No production customer records or original Chicago project settings were modified during local testing.

Release configuration uses a dedicated production PostgreSQL connection and an authenticated owner account. Photos and reviews require the business's authorized content; published customer gallery/review lists intentionally start empty. External ad-spend APIs are not connected.
