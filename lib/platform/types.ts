export type Role = "owner" | "admin" | "manager" | "staff";
export type Session = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: Role;
};
export type Attribution = {
  source: string;
  medium: string;
  campaign: string;
  term: string;
  content: string;
  gclid: string;
  fbclid: string;
  landing_page: string;
  referrer: string;
};
export type Service = {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  includes: string[];
  price_cents: number;
  suv_extra_cents: number;
  truck_extra_cents: number;
  pricing_mode: "fixed" | "starting" | "quote";
  duration_minutes: number;
  active: boolean;
  sort_order: number;
  image_url: string;
};
export type BusinessSettings = {
  name: string;
  phone: string;
  email: string;
  address: string;
  hours_label: string;
  service_area: string;
  appointment_mode: "shop" | "mobile" | "both";
  days: number[];
  open_time: string;
  close_time: string;
  buffer_minutes: number;
  deposit_percent: number;
  cancellation_policy: string;
  logo_url: string;
  favicon_url: string;
  instagram_url: string;
  google_review_url: string;
  google_tag_id: string;
  ga4_id: string;
  google_ads_id: string;
  google_ads_label: string;
  meta_pixel_id: string;
  meta_dataset_id: string;
  email_from: string;
  telegram_chat_id: string;
  sms_from: string;
  email_provider: "resend";
};
export type Customer = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  notes: string;
  marketing_email: boolean;
  marketing_sms: boolean;
  sms_opted_out: boolean;
  attribution_id: string | null;
  created_at: string;
  updated_at: string;
  total_spent?: number;
  booking_count?: number;
};
export type Booking = {
  id: string;
  lead_id: string | null;
  reference: string;
  customer_id: string;
  vehicle_id: string;
  service_id: string;
  service_name: string;
  service_snapshot: Service;
  booking_date: string;
  start_minute: number;
  duration_minutes: number;
  buffer_minutes: number;
  status: string;
  price_cents: number | null;
  deposit_cents: number;
  notes: string;
  internal_notes: string;
  assigned_to: string | null;
  location: string;
  attribution_id: string | null;
  created_at: string;
  customer_name?: string;
  email?: string;
  phone?: string;
  vehicle?: string;
  paid_cents?: number;
};
export type GalleryItem = {
  id: string;
  title: string;
  caption: string;
  category: string;
  image_url: string;
  before_url: string;
  sort_order: number;
  published: boolean;
};
export type Review = {
  id: string;
  customer_id: string | null;
  booking_id: string | null;
  name: string;
  rating: number;
  text: string;
  status: string;
  created_at: string;
};
export type Message = {
  id: string;
  customer_id: string | null;
  booking_id: string | null;
  campaign_id: string | null;
  channel: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  provider_id: string;
  error: string;
  attempts: number;
  scheduled_at: string;
  purpose: string;
};
export type Row = Record<string, unknown>;
export const bookingStatuses = [
  "new",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
] as const;
export const leadStatuses = [
  "new",
  "contacted",
  "qualified",
  "booked",
  "won",
  "lost",
] as const;
export const channels = [
  "Google Ads",
  "Meta Ads",
  "Organic",
  "Direct",
  "Referral",
  "Google Business Profile",
  "Website",
  "Phone",
  "Other",
] as const;
export function money(cents: number | null | undefined) {
  return cents == null
    ? "By consultation"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(cents / 100);
}
export function timeLabel(minute: number) {
  const h = Math.floor(minute / 60);
  return `${h % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
export function dateToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function priceFor(s: Service, type: string) {
  return s.pricing_mode === "quote"
    ? null
    : s.price_cents +
        (type === "SUV"
          ? s.suv_extra_cents
          : type === "Truck"
            ? s.truck_extra_cents
            : 0);
}
