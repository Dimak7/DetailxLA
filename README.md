# DETAILX LA

Premium mobile detailing website for DETAILX LA, built as a separate Next.js project for Los Angeles with the same booking flow, admin tools, pricing logic, and deployment shape as the original DETAILX site.

## Stack

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- PostgreSQL via `pg`
- Resend for booking and invoice emails
- Telegram Bot API for booking notifications and admin actions
- Twilio for optional SMS confirmations
- Stripe for admin-created payment links

## Core features

- Mobile-first public site with LA branding and SEO metadata
- Booking flow powered by `POST /api/book`
- Availability checks via `GET /api/availability?date=YYYY-MM-DD`
- Shared admin portal under `/admin`
- PostgreSQL persistence in production, local JSON fallback for development
- Privacy Notice and Service Rules pages in the footer

## Local setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Run `npm run dev`.
5. Open `http://localhost:3000`.

## Required production variables

```bash
NEXT_PUBLIC_SITE_URL=https://your-domain-or-railway-url
DATABASE_URL=
ADMIN_EMAIL=
ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
RESEND_API_KEY=
BUSINESS_EMAIL=
EMAIL_FROM=
RESEND_FROM_EMAIL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_WEBHOOK_SECRET=
CRON_SECRET=
STRIPE_SECRET_KEY=
```

Optional public contact variables:

```bash
NEXT_PUBLIC_BUSINESS_PHONE=
NEXT_PUBLIC_INSTAGRAM_URL=
NEXT_PUBLIC_INSTAGRAM_HANDLE=@detailxla
NEXT_PUBLIC_GOOGLE_BUSINESS_URL=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
ADMIN_SCHEDULE_KEY=
DATABASE_SSL=false
```

## Railway notes

- Create a new Railway project for this repo only.
- Use the standard Next.js commands:
  - Build: `npm run build`
  - Start: `npm run start`
- Attach a PostgreSQL database before taking live bookings.
- Set the Telegram webhook to:

```bash
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<NEXT_PUBLIC_SITE_URL>/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

- If using a Railway cron for daily Telegram schedule messages, call:

```bash
GET /api/telegram/daily-schedule?secret=<CRON_SECRET>
```

The app computes "today" in `America/Los_Angeles`.
