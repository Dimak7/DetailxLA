import { randomUUID, scryptSync, randomBytes } from "node:crypto";
import type { Query } from "./db";
import type { BusinessSettings } from "./types";

export const defaultSettings: BusinessSettings = {
  name: "West Loop Auto Spa",
  phone: "",
  email: "",
  address: "",
  hours_label: "By appointment",
  service_area: "West Loop, Fulton Market, River North, South Loop, Chicago",
  appointment_mode: "shop",
  days: [1, 2, 3, 4, 5, 6],
  open_time: "08:00",
  close_time: "18:00",
  buffer_minutes: 30,
  deposit_percent: 0,
  cancellation_policy:
    "Please contact us as early as possible to reschedule. We confirm scope and any price changes with you before work begins.",
  logo_url: "",
  favicon_url: "",
  instagram_url: "",
  google_review_url: "",
  google_tag_id: "",
  ga4_id: "",
  google_ads_id: "",
  google_ads_label: "",
  meta_pixel_id: "",
  meta_dataset_id: "",
  email_from: "",
  telegram_chat_id: "",
  sms_from: "",
  email_provider: "resend",
};
const catalog = [
  [
    "Exterior Detail",
    "exterior-detail",
    "Essential care",
    "A considered hand wash. A beautifully finished exterior.",
    10000,
    120,
    [
      "Hand wash",
      "Wheels and tires",
      "Exterior glass",
      "Tire dressing",
      "Wax where suitable",
    ],
    "fixed",
    "black-mercedes-rear.jpg",
  ],
  [
    "Interior Detail",
    "interior-detail",
    "Essential care",
    "A fresh start for the space you spend time in.",
    16000,
    180,
    [
      "Full vacuum",
      "Seats and carpets cleaned",
      "Dashboard, doors and vents",
      "Stain treatment",
      "Odor reduction",
    ],
    "fixed",
    "white-bmw-interior.jpg",
  ],
  [
    "Full Detail",
    "full-detail",
    "Signature care",
    "Our signature interior and exterior reset.",
    25000,
    240,
    [
      "Full interior detail",
      "Exterior hand wash",
      "Wheels and tires",
      "Trim refresh",
      "Wax protection",
    ],
    "fixed",
    "black-porsche-driveway.jpg",
  ],
  [
    "Deep Interior Cleaning",
    "deep-interior-cleaning",
    "Restorative care",
    "Extra attention for interiors that need more.",
    35000,
    300,
    [
      "Deep extraction",
      "Stain treatment",
      "Pet hair removal",
      "Detailed interior cleaning",
      "Condition assessment",
    ],
    "starting",
    "tan-interior-detail.jpg",
  ],
  [
    "Paint Correction",
    "paint-correction",
    "Surface refinement",
    "Refine reflections. Restore depth and clarity.",
    30000,
    300,
    [
      "Paint inspection",
      "Decontamination",
      "Machine polishing",
      "Finish inspection",
    ],
    "starting",
    "black-porsche-studio.jpg",
  ],
  [
    "Ceramic Coating",
    "ceramic-coating",
    "Surface protection",
    "Lasting gloss with a simpler care routine.",
    50000,
    360,
    [
      "Surface preparation",
      "Panel wipe",
      "Coating application",
      "Cure and aftercare guidance",
    ],
    "starting",
    "mercedes-tail-light.jpg",
  ],
  [
    "Maintenance Detail",
    "maintenance-detail",
    "Ongoing care",
    "Keep that just-detailed feeling, on your schedule.",
    0,
    120,
    [
      "Condition review",
      "Recurring visit planning",
      "Interior and exterior upkeep",
    ],
    "quote",
    "silver-porsche-street.jpg",
  ],
  [
    "Headlight Restoration",
    "headlight-restoration",
    "Restorative care",
    "A clearer outlook and a cleaner finish.",
    12000,
    90,
    ["Headlight prep", "Restoration", "Protective finish"],
    "starting",
    "red-audi-headlight.jpg",
  ],
] as const;
export async function seed(q: Query) {
  await q(
    "INSERT INTO wl.settings(key,value) VALUES ('business',$1::jsonb) ON CONFLICT DO NOTHING",
    [JSON.stringify(defaultSettings)],
  );
  for (const [
    name,
    slug,
    category,
    description,
    price,
    duration,
    includes,
    mode,
    image,
  ] of catalog) {
    await q(
      `INSERT INTO wl.services(id,name,slug,category,description,price_cents,duration_minutes,includes,pricing_mode,sort_order,image_url,suv_extra_cents,truck_extra_cents)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13 WHERE NOT EXISTS(SELECT 1 FROM wl.settings WHERE key='catalog_initialized')
    ON CONFLICT(slug) DO NOTHING`,
      [
        randomUUID(),
        name,
        slug,
        category,
        description,
        price,
        duration,
        JSON.stringify(includes),
        mode,
        catalog.findIndex((s) => s[1] === slug),
        "/portfolio/" + image,
        mode === "fixed" ? 2000 : 0,
        mode === "fixed" ? 4000 : 0,
      ],
    );
  }
  await q(
    "INSERT INTO wl.settings(key,value) VALUES ('catalog_initialized','true') ON CONFLICT DO NOTHING",
  );
  const templates = {
    booking_confirmation: [
      "Your appointment at {{business_name}}",
      "Hi {{customer_name}},\nYour {{service_name}} appointment is reserved for {{booking_date}} at {{booking_time}} (Chicago time).\nVehicle: {{vehicle}}\nEstimate: {{total}}\n{{booking_url}}",
    ],
    booking_reminder: [
      "Your appointment is tomorrow",
      "Hi {{customer_name}}, we look forward to your {{service_name}} appointment on {{booking_date}} at {{booking_time}}.\n{{booking_url}}",
    ],
    booking_rescheduled: [
      "Your updated appointment",
      "Hi {{customer_name}}, your appointment is now {{booking_date}} at {{booking_time}}.\n{{booking_url}}",
    ],
    booking_cancelled: [
      "Appointment cancelled",
      "Hi {{customer_name}}, your {{service_name}} appointment on {{booking_date}} has been cancelled. Contact us to book another visit.",
    ],
    follow_up: [
      "Thank you for visiting",
      "Hi {{customer_name}}, thank you for choosing {{business_name}} for your {{service_name}}. We hope you enjoy the finish.",
    ],
    review_request: [
      "How was your visit?",
      "Hi {{customer_name}}, we would love your feedback on your {{service_name}}.\n{{review_url}}",
    ],
    new_booking: [
      "New appointment: {{customer_name}}",
      "Customer: {{customer_name}}\nPhone: {{phone}}\nService: {{service_name}}\nVehicle: {{vehicle}}\nWhen: {{booking_date}} at {{booking_time}}\nEstimate: {{total}}\nSource: {{source}}\n{{admin_url}}",
    ],
    payment: [
      "Payment received",
      "Hi {{customer_name}}, we received {{total}} for your {{service_name}}. Thank you.\n{{booking_url}}",
    ],
    new_lead: [
      "New enquiry: {{customer_name}}",
      "Name: {{customer_name}}\nEmail: {{email}}\nPhone: {{phone}}\n{{notes}}",
    ],
    new_customer: [
      "New customer: {{customer_name}}",
      "{{customer_name}} has joined your customer records.\n{{admin_url}}",
    ],
    business_cancellation: [
      "Cancelled: {{customer_name}}",
      "{{customer_name}} cancelled {{service_name}} on {{booking_date}} at {{booking_time}}.\n{{admin_url}}",
    ],
  } as const;
  for (const [key, [subject, body]] of Object.entries(templates))
    await q(
      "INSERT INTO wl.email_templates(key,subject,body) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [key, subject, body],
    );
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    if (process.env.ADMIN_PASSWORD.length < 12)
      throw new Error("ADMIN_PASSWORD must have at least 12 characters.");
    const salt = randomBytes(16).toString("hex");
    const hash =
      salt +
      ":" +
      scryptSync(process.env.ADMIN_PASSWORD, salt, 64).toString("hex");
    await q(
      "INSERT INTO wl.users(id,name,email,password_hash,role) VALUES ($1,'Owner',$2,$3,'owner') ON CONFLICT(email) DO NOTHING",
      [randomUUID(), process.env.ADMIN_EMAIL.toLowerCase().trim(), hash],
    );
  }
}
