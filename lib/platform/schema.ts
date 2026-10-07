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
 content text NOT NULL DEFAULT '', gclid text NOT NULL DEFAULT '', gbraid text NOT NULL DEFAULT '', wbraid text NOT NULL DEFAULT '', fbclid text NOT NULL DEFAULT '',
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
ALTER TABLE wl.employees ADD COLUMN IF NOT EXISTS first_name text NOT NULL DEFAULT '';
ALTER TABLE wl.employees ADD COLUMN IF NOT EXISTS last_name text NOT NULL DEFAULT '';
ALTER TABLE wl.employees ADD COLUMN IF NOT EXISTS profile_photo_url text NOT NULL DEFAULT '';
ALTER TABLE wl.employees ADD COLUMN IF NOT EXISTS compensation_model text NOT NULL DEFAULT 'hourly' CHECK(compensation_model IN ('hourly','commission','hourly_commission','flat_job'));
ALTER TABLE wl.employees ADD COLUMN IF NOT EXISTS default_commission_bps integer NOT NULL DEFAULT 0 CHECK(default_commission_bps BETWEEN 0 AND 10000);
ALTER TABLE wl.employees ADD COLUMN IF NOT EXISTS flat_job_pay_cents integer NOT NULL DEFAULT 0 CHECK(flat_job_pay_cents >= 0);
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
CREATE TABLE IF NOT EXISTS wl.employee_pay_rules (
 id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES wl.employees(id), service_id uuid REFERENCES wl.services(id), rule_type text NOT NULL CHECK(rule_type IN ('commission_percent','flat_job')), value integer NOT NULL CHECK(value>=0), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(employee_id,service_id,rule_type));
CREATE TABLE IF NOT EXISTS wl.employee_job_assignments (
 id uuid PRIMARY KEY, booking_id uuid NOT NULL REFERENCES wl.bookings(id), employee_id uuid NOT NULL REFERENCES wl.employees(id), pool_share_bps integer NOT NULL DEFAULT 10000 CHECK(pool_share_bps BETWEEN 0 AND 10000), commission_override_cents integer, notes text NOT NULL DEFAULT '', assigned_by uuid REFERENCES wl.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(booking_id,employee_id));
CREATE INDEX IF NOT EXISTS wl_employee_job_assignments_employee ON wl.employee_job_assignments(employee_id,booking_id);
CREATE TABLE IF NOT EXISTS wl.payroll_adjustments (
 id uuid PRIMARY KEY, pay_period_id uuid NOT NULL REFERENCES wl.pay_periods(id), employee_id uuid NOT NULL REFERENCES wl.employees(id), kind text NOT NULL CHECK(kind IN ('bonus','deduction','correction')), amount_cents integer NOT NULL, reason text NOT NULL, created_by uuid REFERENCES wl.users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.crm_tags (id uuid PRIMARY KEY, name text NOT NULL UNIQUE, color text NOT NULL DEFAULT '#c6a66b', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.customer_tags (customer_id uuid NOT NULL REFERENCES wl.customers(id) ON DELETE CASCADE, tag_id uuid NOT NULL REFERENCES wl.crm_tags(id) ON DELETE CASCADE, created_by uuid REFERENCES wl.users(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(customer_id,tag_id));
ALTER TABLE wl.vehicles ADD COLUMN IF NOT EXISTS trim text NOT NULL DEFAULT '';
ALTER TABLE wl.attributions ADD COLUMN IF NOT EXISTS gbraid text NOT NULL DEFAULT '';
ALTER TABLE wl.attributions ADD COLUMN IF NOT EXISTS wbraid text NOT NULL DEFAULT '';
ALTER TABLE wl.vehicles ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '';
ALTER TABLE wl.vehicles ADD COLUMN IF NOT EXISTS license_plate text NOT NULL DEFAULT '';
ALTER TABLE wl.vehicles ADD COLUMN IF NOT EXISTS vin text NOT NULL DEFAULT '';
ALTER TABLE wl.bookings ADD COLUMN IF NOT EXISTS tip_cents integer NOT NULL DEFAULT 0 CHECK(tip_cents >= 0);
ALTER TABLE wl.employee_job_assignments ADD COLUMN IF NOT EXISTS tip_override_cents integer CHECK(tip_override_cents >= 0);
CREATE TABLE IF NOT EXISTS wl.booking_line_items (
 id uuid PRIMARY KEY, booking_id uuid NOT NULL REFERENCES wl.bookings(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('base_service','upsell')), name text NOT NULL, quantity integer NOT NULL DEFAULT 1 CHECK(quantity>0), unit_price_cents integer NOT NULL CHECK(unit_price_cents>=0), created_by uuid REFERENCES wl.users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS wl_booking_line_items_booking ON wl.booking_line_items(booking_id);
CREATE TABLE IF NOT EXISTS wl.booking_discounts (
 id uuid PRIMARY KEY, booking_id uuid NOT NULL REFERENCES wl.bookings(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('fixed','percent')), value integer NOT NULL CHECK(value>=0), amount_cents integer NOT NULL CHECK(amount_cents>=0), reason text NOT NULL DEFAULT '', code text NOT NULL DEFAULT '', applied_by uuid REFERENCES wl.users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS wl_booking_discounts_booking ON wl.booking_discounts(booking_id);
ALTER TABLE wl.bookings ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE wl.payments ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe' CHECK(provider IN ('stripe','square','manual'));
ALTER TABLE wl.payments ADD COLUMN IF NOT EXISTS external_id text NOT NULL DEFAULT '';
ALTER TABLE wl.payments ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT '';
ALTER TABLE wl.payments ADD COLUMN IF NOT EXISTS processor_fee_cents integer NOT NULL DEFAULT 0 CHECK(processor_fee_cents >= 0);
ALTER TABLE wl.payments ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS wl_payment_provider_external_unique ON wl.payments(provider,external_id) WHERE external_id<>'';
CREATE INDEX IF NOT EXISTS wl_payments_financial_lookup ON wl.payments(status,paid_at,booking_id,customer_id);
CREATE TABLE IF NOT EXISTS wl.square_payments (
 environment text NOT NULL CHECK(environment IN ('production','sandbox')), payment_id text NOT NULL,
 location_id text NOT NULL DEFAULT '', order_id text NOT NULL DEFAULT '', status text NOT NULL,
 amount_cents bigint NOT NULL DEFAULT 0 CHECK(amount_cents >= 0), tip_cents bigint NOT NULL DEFAULT 0 CHECK(tip_cents >= 0),
 refunded_cents bigint NOT NULL DEFAULT 0 CHECK(refunded_cents >= 0), processor_fee_cents bigint NOT NULL DEFAULT 0,
 currency text NOT NULL, source_type text NOT NULL DEFAULT '', payment_method text NOT NULL DEFAULT '', receipt_url text NOT NULL DEFAULT '',
 created_at timestamptz, updated_at timestamptz, paid_at timestamptz, synced_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,payment_id));
CREATE INDEX IF NOT EXISTS wl_square_payments_financial_lookup ON wl.square_payments(environment,status,currency,paid_at);
CREATE INDEX IF NOT EXISTS wl_square_payments_order_lookup ON wl.square_payments(environment,order_id) WHERE order_id<>'';
CREATE INDEX IF NOT EXISTS wl_payment_square_order_lookup ON wl.payments((metadata->>'square_environment'),(metadata->>'square_order_id')) WHERE provider='square';
CREATE TABLE IF NOT EXISTS wl.square_sync (
 environment text PRIMARY KEY CHECK(environment IN ('production','sandbox')), cursor jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'idle', last_synced_at timestamptz, last_error text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now());
-- Square is authoritative for its own payments. Linking is optional and never creates a booking or customer.
CREATE OR REPLACE VIEW wl.revenue_payments AS
SELECT
 'square:' || s.environment || ':' || s.payment_id AS id,
 linked.booking_id, linked.customer_id, s.amount_cents, s.refunded_cents, s.processor_fee_cents,
 CASE WHEN s.refunded_cents >= s.amount_cents AND s.refunded_cents > 0 THEN 'refunded'
      WHEN s.refunded_cents > 0 THEN 'partially_refunded' ELSE 'paid' END AS status,
 'square'::text AS provider, s.paid_at, s.created_at,
 COALESCE(linked.checkout_url,'') AS checkout_url, s.payment_id AS external_id,
 s.payment_method, COALESCE(linked.kind,'payment') AS kind,
 COALESCE(linked.metadata,'{}'::jsonb) || jsonb_build_object(
   'square_environment',s.environment,'square_order_id',s.order_id,'square_location_id',s.location_id,
   'square_source_type',s.source_type,'square_receipt_url',s.receipt_url,'square_ledger',true
 ) AS metadata, s.tip_cents
FROM wl.square_payments s
LEFT JOIN LATERAL (
 SELECT p.* FROM wl.payments p
 WHERE p.provider='square' AND p.metadata->>'square_environment'=s.environment
   AND (p.external_id=s.payment_id OR (
     s.order_id<>'' AND p.metadata->>'square_order_id'=s.order_id
     AND (SELECT count(*) FROM wl.payments other
          WHERE other.provider='square' AND other.metadata->>'square_environment'=s.environment
            AND other.metadata->>'square_order_id'=s.order_id)=1
   ))
 ORDER BY (p.external_id=s.payment_id) DESC,p.created_at,p.id
 LIMIT 1
) linked ON true
WHERE s.environment='production' AND s.currency='USD' AND s.status='COMPLETED'
UNION ALL
SELECT p.id::text,p.booking_id,p.customer_id,p.amount_cents::bigint,p.refunded_cents::bigint,
 p.processor_fee_cents::bigint,p.status,p.provider,p.paid_at,p.created_at,p.checkout_url,p.external_id,
 p.payment_method,p.kind,p.metadata,0::bigint AS tip_cents
FROM wl.payments p
WHERE p.provider<>'square' OR (
 p.metadata->>'square_environment'='production'
 AND NOT EXISTS (
   SELECT 1 FROM wl.square_payments s
   WHERE s.environment='production' AND (
     (p.external_id<>'' AND s.payment_id=p.external_id)
     OR (s.order_id<>'' AND s.order_id=p.metadata->>'square_order_id')
   )
 )
);
CREATE TABLE IF NOT EXISTS wl.audit_logs (
 id uuid PRIMARY KEY, actor_id uuid REFERENCES wl.users(id), entity_type text NOT NULL, entity_id uuid, action text NOT NULL, before_data jsonb NOT NULL DEFAULT '{}', after_data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wl.expenses (
 id uuid PRIMARY KEY, expense_date text NOT NULL, amount_cents integer NOT NULL CHECK(amount_cents >= 0), category text NOT NULL,
 vendor text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '', payment_method text NOT NULL DEFAULT '', recurrence text NOT NULL DEFAULT 'one_time' CHECK(recurrence IN ('one_time','weekly','monthly','yearly')),
 recurring_start text, recurring_end text, receipt_url text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', created_by uuid REFERENCES wl.users(id), updated_by uuid REFERENCES wl.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS wl_expenses_date ON wl.expenses(expense_date);
CREATE INDEX IF NOT EXISTS wl_expenses_category_date ON wl.expenses(category,expense_date);
CREATE TABLE IF NOT EXISTS wl.inventory_items (
 id uuid PRIMARY KEY, name text NOT NULL, sku text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'Other', quantity numeric NOT NULL DEFAULT 0 CHECK(quantity >= 0),
 unit text NOT NULL DEFAULT 'units', unit_cost_cents integer NOT NULL DEFAULT 0 CHECK(unit_cost_cents >= 0), supplier text NOT NULL DEFAULT '', minimum_stock numeric NOT NULL DEFAULT 0 CHECK(minimum_stock >= 0),
 reorder_quantity numeric NOT NULL DEFAULT 0 CHECK(reorder_quantity >= 0), last_purchase_date text, notes text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS wl_inventory_sku_unique ON wl.inventory_items(sku) WHERE sku<>'';
CREATE INDEX IF NOT EXISTS wl_inventory_active ON wl.inventory_items(active,category);
CREATE TABLE IF NOT EXISTS wl.inventory_movements (
 id uuid PRIMARY KEY, item_id uuid NOT NULL REFERENCES wl.inventory_items(id) ON DELETE CASCADE, movement_type text NOT NULL CHECK(movement_type IN ('purchase','usage','adjustment','return','waste','correction')),
 quantity numeric NOT NULL CHECK(quantity<>0), unit_cost_cents integer, occurred_on text NOT NULL, notes text NOT NULL DEFAULT '', expense_id uuid UNIQUE REFERENCES wl.expenses(id), created_by uuid REFERENCES wl.users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS wl_inventory_movements_item_date ON wl.inventory_movements(item_id,occurred_on DESC);
INSERT INTO wl.migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
WITH migration AS (
  INSERT INTO wl.migrations(version) VALUES (2)
  ON CONFLICT DO NOTHING
  RETURNING version
)
UPDATE wl.settings
SET value = jsonb_set(
      jsonb_set(value, '{close_time}', '"20:00"'::jsonb),
      '{hours_label}',
      '"Monday-Saturday, 8:00 AM-8:00 PM"'::jsonb
    ),
    updated_at = now()
WHERE key = 'business'
  AND EXISTS (SELECT 1 FROM migration);
-- Preserve the old effective plan once, before employee settings become authoritative.
-- Rules that the old calculator ignored remain saved but inactive until a manager enables them.
-- Paid payroll records are historical snapshots and are deliberately untouched.
WITH migration AS (
  INSERT INTO wl.migrations(version) VALUES (3)
  ON CONFLICT DO NOTHING
  RETURNING version
), inactive_legacy_rules AS (
  UPDATE wl.employee_pay_rules r SET active=false,updated_at=now()
  FROM wl.employees e
  WHERE r.employee_id=e.id AND r.active=true AND EXISTS (SELECT 1 FROM migration)
    AND (lower(e.position)='detailer' OR e.compensation_model='hourly'
      OR (r.rule_type='flat_job' AND e.compensation_model<>'flat_job')
      OR (r.rule_type='commission_percent' AND e.compensation_model='flat_job'))
  RETURNING r.id
)
UPDATE wl.employees
SET hourly_rate_cents=1000,compensation_model='hourly_commission',default_commission_bps=3000,updated_at=now()
WHERE lower(position)='detailer' AND EXISTS (SELECT 1 FROM migration);
-- Add Sunday only to the former default schedule; preserve custom business hours.
WITH migration AS (
  INSERT INTO wl.migrations(version) VALUES (4)
  ON CONFLICT DO NOTHING
  RETURNING version
)
UPDATE wl.settings
SET value = value || '{"days":[0,1,2,3,4,5,6],"day_hours":[{"weekday":0,"open_time":"08:00","close_time":"17:00"}],"hours_label":"Monday-Saturday, 8:00 AM-8:00 PM; Sunday, 8:00 AM-5:00 PM"}'::jsonb,
    updated_at = now()
WHERE key='business'
  AND EXISTS (SELECT 1 FROM migration)
  AND value->'days'='[1,2,3,4,5,6]'::jsonb
  AND value->>'open_time'='08:00'
  AND value->>'close_time'='20:00'
  AND value->>'hours_label'='Monday-Saturday, 8:00 AM-8:00 PM'
  AND (NOT value ? 'day_hours' OR value->'day_hours'='[]'::jsonb);
-- Apply the approved public service menu and service-specific photography once.
WITH migration AS (
  INSERT INTO wl.migrations(version) VALUES (5)
  ON CONFLICT DO NOTHING
  RETURNING version
)
UPDATE wl.services AS service
SET price_cents=menu.price_cents,
    suv_extra_cents=menu.suv_extra_cents,
    truck_extra_cents=menu.truck_extra_cents,
    pricing_mode=menu.pricing_mode,
    image_url=menu.image_url,
    updated_at=now()
FROM (VALUES
  ('interior-detail',30000,2500,5000,'fixed','/brand/photography/interior-detail.webp'),
  ('exterior-detail',25000,2500,5000,'fixed','/brand/photography/exterior-detail.webp'),
  ('full-detail',50000,5000,10000,'fixed','/brand/photography/full-detail-studio.webp'),
  ('deep-interior-cleaning',35000,0,0,'starting','/brand/photography/deep-interior.webp'),
  ('paint-correction',52500,0,0,'starting','/brand/photography/paint-correction.webp'),
  ('ceramic-coating',55000,0,0,'starting','/brand/photography/ceramic-coating.webp'),
  ('maintenance-detail',0,0,0,'quote','/brand/photography/exterior-detail.webp'),
  ('headlight-restoration',7500,0,0,'starting','/brand/photography/headlight-restoration.webp')
) AS menu(slug,price_cents,suv_extra_cents,truck_extra_cents,pricing_mode,image_url)
WHERE service.slug=menu.slug AND EXISTS (SELECT 1 FROM migration);
-- Keep the established slug while updating the customer-facing service name.
WITH migration AS (
  INSERT INTO wl.migrations(version) VALUES (6)
  ON CONFLICT DO NOTHING
  RETURNING version
)
UPDATE wl.services
SET name='Extensive Interior Detail', updated_at=now()
WHERE slug='deep-interior-cleaning' AND EXISTS (SELECT 1 FROM migration);
-- Keep the advertised Full Detail starting price consistent through booking and checkout.
WITH migration AS (
  INSERT INTO wl.migrations(version) VALUES (7)
  ON CONFLICT DO NOTHING
  RETURNING version
)
UPDATE wl.services
SET price_cents=25000, pricing_mode='starting', updated_at=now()
WHERE slug='full-detail' AND EXISTS (SELECT 1 FROM migration);
-- Restore the approved Full Detail price and publish the studio's social profiles.
WITH migration AS (
  INSERT INTO wl.migrations(version) VALUES (8)
  ON CONFLICT DO NOTHING
  RETURNING version
), service_update AS (
  UPDATE wl.services
  SET price_cents=50000, pricing_mode='starting', updated_at=now()
  WHERE slug='full-detail' AND EXISTS (SELECT 1 FROM migration)
  RETURNING id
)
UPDATE wl.settings
SET value=jsonb_set(
      jsonb_set(value, '{instagram_url}', '"https://www.instagram.com/westloopautospa/"'::jsonb),
      '{google_review_url}', '"https://share.google/wcuAF8LhyOu4FOpsx"'::jsonb
    ),
    updated_at=now()
WHERE key='business' AND EXISTS (SELECT 1 FROM migration);
`;
