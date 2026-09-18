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
CREATE TABLE IF NOT EXISTS wl.employees (
 id uuid PRIMARY KEY, user_id uuid UNIQUE REFERENCES wl.users(id), phone text NOT NULL DEFAULT '', position text NOT NULL DEFAULT 'Other',
 hourly_rate_cents integer NOT NULL DEFAULT 0 CHECK(hourly_rate_cents >= 0), hire_date text, notes text NOT NULL DEFAULT '', avatar_url text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE wl.employees ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
ALTER TABLE wl.employees ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
ALTER TABLE wl.employees ADD COLUMN IF NOT EXISTS max_weekly_minutes integer NOT NULL DEFAULT 2400 CHECK(max_weekly_minutes BETWEEN 60 AND 10080);
CREATE TABLE IF NOT EXISTS wl.employee_availability (
 employee_id uuid NOT NULL REFERENCES wl.employees(id) ON DELETE CASCADE, weekday integer NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 available boolean NOT NULL DEFAULT false, start_minute integer NOT NULL DEFAULT 480 CHECK(start_minute BETWEEN 0 AND 1439), end_minute integer NOT NULL DEFAULT 1020 CHECK(end_minute BETWEEN 0 AND 1440),
 PRIMARY KEY(employee_id,weekday), CHECK(end_minute > start_minute));
CREATE TABLE IF NOT EXISTS wl.employee_shifts (
 id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES wl.employees(id), shift_date text NOT NULL,
 start_minute integer NOT NULL DEFAULT 0 CHECK(start_minute BETWEEN 0 AND 1439), end_minute integer NOT NULL DEFAULT 0 CHECK(end_minute BETWEEN 0 AND 1440),
 break_minutes integer NOT NULL DEFAULT 0 CHECK(break_minutes BETWEEN 0 AND 720), status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','off','pto','sick')),
 notes text NOT NULL DEFAULT '', published boolean NOT NULL DEFAULT false, created_by uuid REFERENCES wl.users(id), updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status <> 'scheduled') OR end_minute > start_minute));
CREATE INDEX IF NOT EXISTS wl_employee_shifts_date ON wl.employee_shifts(shift_date,employee_id);
CREATE TABLE IF NOT EXISTS wl_daily_staffing_requirements (
 staffing_date text PRIMARY KEY, required_staff integer NOT NULL DEFAULT 0 CHECK(required_staff BETWEEN 0 AND 100),
 created_by uuid REFERENCES wl.users(id), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.time_entries (
 id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES wl.employees(id), shift_id uuid REFERENCES wl.employee_shifts(id),
 clock_in timestamptz NOT NULL, clock_out timestamptz, break_started_at timestamptz, break_minutes integer NOT NULL DEFAULT 0 CHECK(break_minutes >= 0),
 approved boolean NOT NULL DEFAULT false, notes text NOT NULL DEFAULT '', edited_by uuid REFERENCES wl.users(id), edited_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(clock_out IS NULL OR clock_out > clock_in));
CREATE UNIQUE INDEX IF NOT EXISTS wl_one_active_clock ON wl.time_entries(employee_id) WHERE clock_out IS NULL;
CREATE TABLE IF NOT EXISTS wl.time_correction_requests (
 id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES wl.employees(id), time_entry_id uuid REFERENCES wl.time_entries(id), request text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','approved','rejected')), manager_note text NOT NULL DEFAULT '', reviewed_by uuid REFERENCES wl.users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.time_off_requests (
 id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES wl.employees(id), start_date text NOT NULL, end_date text NOT NULL, reason text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','approved','denied')), reviewed_by uuid REFERENCES wl.users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), CHECK(end_date >= start_date));
CREATE TABLE IF NOT EXISTS wl.schedule_notifications (
 id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES wl.employees(id), week_start text NOT NULL, channel text NOT NULL DEFAULT 'sms', status text NOT NULL DEFAULT 'pending', provider_id text NOT NULL DEFAULT '', error text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.pay_periods (
 id uuid PRIMARY KEY, start_date text NOT NULL, end_date text NOT NULL, frequency text NOT NULL DEFAULT 'weekly' CHECK(frequency IN ('weekly','biweekly','semi_monthly')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','review','approved','paid')), overtime_threshold numeric NOT NULL DEFAULT 40, overtime_multiplier numeric NOT NULL DEFAULT 1.5,
 created_by uuid REFERENCES wl.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(start_date,end_date), CHECK(end_date >= start_date));
CREATE TABLE IF NOT EXISTS wl.payroll_records (
 id uuid PRIMARY KEY, pay_period_id uuid NOT NULL REFERENCES wl.pay_periods(id), employee_id uuid NOT NULL REFERENCES wl.employees(id),
 regular_minutes integer NOT NULL DEFAULT 0, overtime_minutes integer NOT NULL DEFAULT 0, pto_minutes integer NOT NULL DEFAULT 0, sick_minutes integer NOT NULL DEFAULT 0,
 hourly_rate_cents integer NOT NULL, estimated_gross_cents integer NOT NULL DEFAULT 0, approved_at timestamptz, UNIQUE(pay_period_id,employee_id));
CREATE TABLE IF NOT EXISTS wl.audit_logs (
 id uuid PRIMARY KEY, actor_id uuid REFERENCES wl.users(id), entity_type text NOT NULL, entity_id uuid, action text NOT NULL, before_data jsonb NOT NULL DEFAULT '{}', after_data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO wl.migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
`;
