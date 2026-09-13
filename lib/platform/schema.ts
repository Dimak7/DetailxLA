export const schema = `
CREATE SCHEMA IF NOT EXISTS wl;
CREATE TABLE IF NOT EXISTS wl.migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.secrets (key text PRIMARY KEY, ciphertext text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.users (
 id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('owner','admin','manager','staff')), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.sessions (id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES wl.users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.password_resets (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES wl.users(id), expires_at timestamptz NOT NULL, used_at timestamptz);
CREATE TABLE IF NOT EXISTS wl.rate_limits (key text PRIMARY KEY, count integer NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS wl.attributions (
 id uuid PRIMARY KEY, session_id text NOT NULL UNIQUE, source text NOT NULL DEFAULT 'Direct',
 medium text NOT NULL DEFAULT '', campaign text NOT NULL DEFAULT '', term text NOT NULL DEFAULT '',
 content text NOT NULL DEFAULT '', gclid text NOT NULL DEFAULT '', fbclid text NOT NULL DEFAULT '',
 landing_page text NOT NULL DEFAULT '', referrer text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.customers (
 id uuid PRIMARY KEY, first_name text NOT NULL, last_name text NOT NULL, email text NOT NULL UNIQUE, phone text NOT NULL,
 notes text NOT NULL DEFAULT '', marketing_email boolean NOT NULL DEFAULT false, marketing_sms boolean NOT NULL DEFAULT false,
 sms_opted_out boolean NOT NULL DEFAULT false, attribution_id uuid REFERENCES wl.attributions(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS wl_customer_phone ON wl.customers(phone);
CREATE TABLE IF NOT EXISTS wl.vehicles (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES wl.customers(id), make text NOT NULL, model text NOT NULL,
 year integer NOT NULL CHECK (year BETWEEN 1900 AND 2200), type text NOT NULL, condition text NOT NULL DEFAULT '',
 UNIQUE(customer_id,make,model,year,type));
CREATE TABLE IF NOT EXISTS wl.services (
 id uuid PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, category text NOT NULL,
 description text NOT NULL, includes jsonb NOT NULL DEFAULT '[]', price_cents integer NOT NULL CHECK(price_cents >= 0),
 suv_extra_cents integer NOT NULL DEFAULT 0 CHECK(suv_extra_cents >= 0), truck_extra_cents integer NOT NULL DEFAULT 0 CHECK(truck_extra_cents >= 0),
 pricing_mode text NOT NULL CHECK(pricing_mode IN ('fixed','starting','quote')),
 duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 30 AND 720),
 active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0, image_url text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.leads (
 id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','qualified','booked','won','lost')),
 notes text NOT NULL DEFAULT '', assigned_to uuid REFERENCES wl.users(id), customer_id uuid REFERENCES wl.customers(id),
 attribution_id uuid REFERENCES wl.attributions(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.bookings (
 id uuid PRIMARY KEY, request_key text NOT NULL UNIQUE, request_hash text NOT NULL,
 reference text NOT NULL UNIQUE, customer_id uuid NOT NULL REFERENCES wl.customers(id), vehicle_id uuid NOT NULL REFERENCES wl.vehicles(id),
 service_id uuid NOT NULL REFERENCES wl.services(id), service_name text NOT NULL, service_snapshot jsonb NOT NULL,
 booking_date text NOT NULL, start_minute integer NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
 duration_minutes integer NOT NULL CHECK(duration_minutes > 0), buffer_minutes integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','confirmed','in_progress','completed','cancelled','no_show')),
 price_cents integer CHECK(price_cents >= 0), deposit_cents integer NOT NULL DEFAULT 0 CHECK(deposit_cents >= 0),
 notes text NOT NULL DEFAULT '', internal_notes text NOT NULL DEFAULT '', assigned_to uuid REFERENCES wl.users(id),
 location text NOT NULL DEFAULT '', attribution_id uuid REFERENCES wl.attributions(id), lead_id uuid REFERENCES wl.leads(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS wl_booking_schedule ON wl.bookings(booking_date,start_minute,status);
CREATE INDEX IF NOT EXISTS wl_booking_customer ON wl.bookings(customer_id);
CREATE TABLE IF NOT EXISTS wl.schedule_guard (id integer PRIMARY KEY);
INSERT INTO wl.schedule_guard VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS wl.blocks (id uuid PRIMARY KEY, booking_date text NOT NULL, start_minute integer NOT NULL, end_minute integer NOT NULL CHECK(end_minute > start_minute), reason text NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS wl.payments (
 id uuid PRIMARY KEY, booking_id uuid NOT NULL REFERENCES wl.bookings(id), customer_id uuid NOT NULL REFERENCES wl.customers(id),
 amount_cents integer NOT NULL CHECK(amount_cents > 0), refunded_cents integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed','expired','refunded','partially_refunded')),
 kind text NOT NULL DEFAULT 'balance', stripe_session_id text UNIQUE, stripe_payment_id text UNIQUE,
 checkout_url text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz);
CREATE TABLE IF NOT EXISTS wl.webhooks (id text PRIMARY KEY, provider text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.timeline (
 id uuid PRIMARY KEY, customer_id uuid REFERENCES wl.customers(id), booking_id uuid REFERENCES wl.bookings(id), lead_id uuid REFERENCES wl.leads(id),
 type text NOT NULL, body text NOT NULL, actor_id uuid REFERENCES wl.users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS wl_timeline_customer ON wl.timeline(customer_id,created_at);
CREATE TABLE IF NOT EXISTS wl.consent_events (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES wl.customers(id), channel text NOT NULL, consent boolean NOT NULL,
 wording text NOT NULL, source text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.events (
 id text PRIMARY KEY, name text NOT NULL, session_id text NOT NULL DEFAULT '', customer_id uuid REFERENCES wl.customers(id),
 booking_id uuid REFERENCES wl.bookings(id), attribution_id uuid REFERENCES wl.attributions(id),
 device text NOT NULL DEFAULT '', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS wl_events_time ON wl.events(created_at,name);
CREATE TABLE IF NOT EXISTS wl.campaigns (
 id uuid PRIMARY KEY, name text NOT NULL, channel text NOT NULL CHECK(channel IN ('email','sms')), audience text NOT NULL,
 subject text NOT NULL DEFAULT '', body text NOT NULL, status text NOT NULL DEFAULT 'draft',
 scheduled_at timestamptz, created_by uuid REFERENCES wl.users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.messages (
 id uuid PRIMARY KEY, dedupe_key text NOT NULL UNIQUE, customer_id uuid REFERENCES wl.customers(id), booking_id uuid REFERENCES wl.bookings(id),
 campaign_id uuid REFERENCES wl.campaigns(id), channel text NOT NULL, recipient text NOT NULL, subject text NOT NULL DEFAULT '', body text NOT NULL,
 purpose text NOT NULL DEFAULT 'transactional', status text NOT NULL DEFAULT 'queued', provider_id text NOT NULL DEFAULT '',
 error text NOT NULL DEFAULT '', attempts integer NOT NULL DEFAULT 0, scheduled_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS wl_message_queue ON wl.messages(status,scheduled_at);
CREATE TABLE IF NOT EXISTS wl.email_templates (key text PRIMARY KEY, subject text NOT NULL, body text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.reviews (
 id uuid PRIMARY KEY, customer_id uuid REFERENCES wl.customers(id), booking_id uuid UNIQUE REFERENCES wl.bookings(id),
 name text NOT NULL, rating integer CHECK(rating BETWEEN 1 AND 5), text text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','received','published','hidden')),
 token_hash text UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.media (id uuid PRIMARY KEY, content_type text NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.gallery (
 id uuid PRIMARY KEY, title text NOT NULL, caption text NOT NULL DEFAULT '', category text NOT NULL,
 image_url text NOT NULL, before_url text NOT NULL DEFAULT '', sort_order integer NOT NULL DEFAULT 0, published boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS wl.ad_spend (
 id uuid PRIMARY KEY, channel text NOT NULL, campaign text NOT NULL DEFAULT '', spend_date text NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents >= 0), origin text NOT NULL DEFAULT 'manual');
INSERT INTO wl.migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
`;
