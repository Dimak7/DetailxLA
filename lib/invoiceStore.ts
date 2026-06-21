import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Pool } from "pg";
import type { StoredBooking } from "./bookingStore";
import { getBookingAmount, getBookingDetails } from "./adminData";
import { getDatabasePool } from "./database";
import { sendInvoicePaymentEmail } from "./resend";

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";

export type InvoiceRecord = {
  id: string;
  bookingId: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  status: InvoiceStatus;
  paymentUrl: string;
  stripeSessionId?: string;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceCreationResult =
  | { success: true; invoice: InvoiceRecord; paymentUrl: string; emailSent: boolean; emailError?: string }
  | { success: false; error: string };

type InvoiceRow = {
  id: string;
  booking_id: string;
  customer_name: string;
  customer_email: string;
  amount: number | string;
  status: InvoiceStatus;
  payment_url: string | null;
  stripe_session_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

let hasEnsuredInvoiceSchema = false;

export async function listInvoices() {
  const db = getDatabasePool();

  if (db) {
    await ensureInvoiceSchema(db);
    const result = await db.query<InvoiceRow>(
      `SELECT id, booking_id, customer_name, customer_email, amount, status, payment_url, stripe_session_id, created_at, updated_at
       FROM invoices
       ORDER BY created_at DESC
       LIMIT 500`
    );
    return result.rows.map(mapInvoiceRow);
  }

  return readLocalInvoices();
}

export async function createStripeInvoiceForBooking(booking: StoredBooking): Promise<InvoiceCreationResult> {
  console.info("Invoice creation started", { bookingId: booking.id });

  try {
    const validation = validateInvoiceBookingInput(booking);
    if (!validation.success) {
      console.error("Invoice validation failed", { bookingId: booking.id, error: validation.error });
      return validation;
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      console.error("Stripe invoice creation skipped: STRIPE_SECRET_KEY is not configured.", { bookingId: booking.id });
      return { success: false, error: "STRIPE_SECRET_KEY is not configured." };
    }

    const { amount, amountInCents, customerEmail, customerName, serviceDescription, siteUrl } = validation;
    const body = new URLSearchParams({
      mode: "payment",
      success_url: `${siteUrl}/admin/invoices?payment=success`,
      cancel_url: `${siteUrl}/admin/invoices?payment=cancelled`,
      customer_email: customerEmail,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(amountInCents),
      "line_items[0][price_data][product_data][name]": `DETAILX LA - ${serviceDescription}`,
      "metadata[booking_id]": booking.id,
      "metadata[customer_email]": customerEmail,
    });

    console.info("Stripe invoice request started", {
      bookingId: booking.id,
      amount,
      amountInCents,
      customerEmail,
      siteUrl,
    });

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const data = await response.json().catch(() => null) as { id?: string; url?: string; error?: { message?: string } } | null;

    if (!response.ok || !data?.url || !data.id) {
      const error = data?.error?.message || `Stripe could not create a payment link. Status: ${response.status}`;
      console.error("Stripe invoice creation failed", { bookingId: booking.id, status: response.status, error, response: data });
      return { success: false, error };
    }

    console.info("Stripe invoice creation succeeded", { bookingId: booking.id, stripeSessionId: data.id, paymentUrl: data.url });
    console.info("Invoice payment link created", { bookingId: booking.id, paymentUrl: data.url });

    const invoice = await saveInvoice({
      id: randomUUID(),
      bookingId: booking.id,
      customerName,
      customerEmail,
      amount,
      status: "sent",
      paymentUrl: data.url,
      stripeSessionId: data.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let emailSent = false;
    let emailError: string | undefined;

    try {
      console.info("Invoice payment email send started", { bookingId: booking.id, invoiceId: invoice.id });
      await sendInvoicePaymentEmail(invoice);
      emailSent = true;
      console.info("Invoice payment email sent", { bookingId: booking.id, invoiceId: invoice.id });
    } catch (error) {
      emailError = error instanceof Error ? error.message : "Invoice email could not be sent.";
      console.error("Invoice payment email failed after Stripe success", { bookingId: booking.id, invoiceId: invoice.id, error });
    }

    return { success: true, invoice, paymentUrl: invoice.paymentUrl, emailSent, emailError };
  } catch (error) {
    console.error("Invoice creation crashed safely", { bookingId: booking.id, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Invoice could not be created. Check Stripe setup or booking data.",
    };
  }
}

export async function updateInvoiceStatus(id: string, status: InvoiceStatus) {
  const db = getDatabasePool();

  if (db) {
    await ensureInvoiceSchema(db);
    await db.query("UPDATE invoices SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
    return;
  }

  const invoices = await readLocalInvoices();
  await writeLocalInvoices(invoices.map((invoice) => invoice.id === id ? { ...invoice, status, updatedAt: new Date().toISOString() } : invoice));
}

async function saveInvoice(invoice: InvoiceRecord) {
  const db = getDatabasePool();

  if (db) {
    await ensureInvoiceSchema(db);
    await db.query(
      `INSERT INTO invoices (id, booking_id, customer_name, customer_email, amount, status, payment_url, stripe_session_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, payment_url = EXCLUDED.payment_url, updated_at = EXCLUDED.updated_at`,
      [invoice.id, invoice.bookingId, invoice.customerName, invoice.customerEmail, invoice.amount, invoice.status, invoice.paymentUrl, invoice.stripeSessionId || null, invoice.createdAt, invoice.updatedAt]
    );
    return invoice;
  }

  const invoices = await readLocalInvoices();
  invoices.unshift(invoice);
  await writeLocalInvoices(invoices);
  return invoice;
}

async function ensureInvoiceSchema(db: Pool) {
  if (hasEnsuredInvoiceSchema) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id uuid PRIMARY KEY,
      booking_id uuid NOT NULL,
      customer_name text NOT NULL,
      customer_email text NOT NULL,
      amount integer NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      payment_url text,
      stripe_session_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  hasEnsuredInvoiceSchema = true;
}

async function readLocalInvoices() {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "invoices.json");
  await mkdir(dataDir, { recursive: true });

  try {
    return JSON.parse(await readFile(filePath, "utf8")) as InvoiceRecord[];
  } catch {
    return [];
  }
}

async function writeLocalInvoices(invoices: InvoiceRecord[]) {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "invoices.json");
  await mkdir(dataDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(invoices, null, 2));
}

function mapInvoiceRow(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    bookingId: row.booking_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    amount: Number(row.amount),
    status: row.status,
    paymentUrl: row.payment_url || "",
    stripeSessionId: row.stripe_session_id || undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function validateInvoiceBookingInput(booking: StoredBooking):
  | {
      success: true;
      amount: number;
      amountInCents: number;
      customerEmail: string;
      customerName: string;
      serviceDescription: string;
      siteUrl: string;
    }
  | { success: false; error: string } {
  console.info("Invoice booking loaded", {
    bookingId: booking.id,
    hasName: Boolean(booking.name),
    hasEmail: Boolean(booking.email),
    estimatedPrice: booking.estimatedPrice,
  });

  const customerEmail = (booking.email || "").trim();
  const customerName = (booking.name || "").trim();
  const amount = getBookingAmount(booking);
  const amountInCents = Math.round(amount * 100);
  const serviceDescription = getBookingDetails(booking)
    .map((detail) => `${detail.service} / ${detail.vehicleType}`)
    .filter(Boolean)
    .join(", ")
    .trim();
  const siteUrl = getSiteUrl();

  if (!booking.id) {
    return { success: false, error: "Booking ID is missing." };
  }

  if (!customerEmail) {
    return { success: false, error: "Customer email is missing." };
  }

  if (!customerName) {
    return { success: false, error: "Customer name is missing." };
  }

  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(amountInCents)) {
    return { success: false, error: "Booking total is missing or invalid." };
  }

  if (!serviceDescription) {
    return { success: false, error: "Service description is missing." };
  }

  if (!siteUrl) {
    return { success: false, error: "NEXT_PUBLIC_SITE_URL is invalid." };
  }

  return { success: true, amount, amountInCents, customerEmail, customerName, serviceDescription, siteUrl };
}

function getSiteUrl() {
  const rawUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://detailxla.com").replace(/\/$/, "");

  try {
    const url = new URL(rawUrl);
    return url.origin;
  } catch {
    return "";
  }
}
