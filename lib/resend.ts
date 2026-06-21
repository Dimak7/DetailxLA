import { Resend } from "resend";
import type { BookingInput } from "./bookingSchema";
import { buildBookingEstimate, freeWaxBonusLabel, getDisplayAssetLabel, hasFreeWaxBonus, isBoatDetailingService } from "./pricing";
import { getAbsoluteSiteUrl, siteConfig } from "./siteConfig";

type BookingEmail = BookingInput & { id: string };

const defaultBusinessEmail = "sales@detailxla.com";

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return null;
  }

  return new Resend(apiKey);
}

export function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export function getBusinessEmail() {
  return process.env.BUSINESS_EMAIL || defaultBusinessEmail;
}

export function getResendFromEmail() {
  const fromEmail = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || process.env.BUSINESS_EMAIL || defaultBusinessEmail;
  return fromEmail.includes("<") ? fromEmail : `${siteConfig.brandName} <${fromEmail}>`;
}

export async function sendCustomerBookingConfirmation(booking: BookingEmail) {
  if (!booking.email?.trim()) {
    throw new Error("Customer email is missing; confirmation email was skipped.");
  }

  await sendEmail({
    label: "customer-booking-confirmation",
    to: booking.email,
    subject: "Your DETAILX LA Booking Confirmation",
    html: buildCustomerEmailHtml(booking),
    replyTo: getBusinessEmail(),
  });
}

export async function sendBusinessBookingNotification(booking: BookingEmail) {
  await sendEmail({
    label: "business-booking-notification",
    to: getBusinessEmail(),
    subject: "New Booking - DETAILX LA",
    html: buildBusinessEmailHtml(booking),
    replyTo: booking.email || getBusinessEmail(),
  });
}

export async function sendInvoicePaymentEmail(invoice: {
  customerEmail: string;
  customerName: string;
  amount: number;
  paymentUrl: string;
}) {
  await sendEmail({
    label: "customer-invoice-payment-link",
    to: invoice.customerEmail,
    subject: "Your DETAILX LA Invoice",
    html: `
      <div style="margin:0;background:#f1f1ee;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#050506;line-height:1.5">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e4e4df;border-radius:8px;overflow:hidden">
          <div style="background:#050506;color:#ffffff;padding:28px 26px">
            <p style="margin:0;color:#c1121f;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase">DETAILX LA</p>
            <h1 style="margin:12px 0 0;font-size:32px;line-height:1;text-transform:uppercase">Invoice Ready</h1>
            <p style="margin:12px 0 0;color:#c7c9c7;font-size:16px">Hi ${escapeHtml(invoice.customerName)}, your secure payment link is ready.</p>
          </div>
          <div style="padding:24px;text-align:center">
            <p style="margin:0;color:#73777c;font-size:12px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase">Amount due</p>
            <p style="margin:8px 0 22px;color:#050506;font-size:34px;font-weight:900">$${invoice.amount.toLocaleString("en-US")}</p>
            <a href="${escapeHtml(invoice.paymentUrl)}" style="display:inline-block;border-radius:8px;background:#c1121f;color:#ffffff;font-size:13px;font-weight:900;letter-spacing:0.06em;text-decoration:none;text-transform:uppercase;padding:15px 22px">Pay Securely</a>
          </div>
          <div style="background:#050506;padding:18px 26px;color:#c7c9c7;font-size:13px">DETAILX LA / Premium Mobile Detailing in Los Angeles</div>
        </div>
      </div>
    `,
    replyTo: getBusinessEmail(),
  });
}

export async function sendClientPromotionEmail(input: {
  to: string;
  name: string;
  subject: string;
  message: string;
}) {
  await sendEmail({
    label: "client-promotion-email",
    to: input.to,
    subject: input.subject,
    html: `
      <div style="margin:0;background:#f1f1ee;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#050506;line-height:1.5">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e4e4df;border-radius:8px;overflow:hidden">
          <div style="background:#050506;color:#ffffff;padding:28px 26px">
            <p style="margin:0;color:#c1121f;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase">DETAILX LA</p>
            <h1 style="margin:12px 0 0;font-size:30px;line-height:1;text-transform:uppercase">${escapeHtml(input.subject)}</h1>
          </div>
          <div style="padding:24px">
            <p style="margin:0 0 16px;font-size:16px;font-weight:800">Hi ${escapeHtml(input.name)},</p>
            <div style="color:#333842;font-size:16px;line-height:1.7">${formatEmailMessage(input.message)}</div>
            <div style="margin-top:24px;text-align:center">
              <a href="${getAbsoluteSiteUrl()}/#booking" style="display:inline-block;border-radius:8px;background:#c1121f;color:#ffffff;font-size:13px;font-weight:900;letter-spacing:0.06em;text-decoration:none;text-transform:uppercase;padding:15px 22px">Book Detail</a>
            </div>
          </div>
          <div style="background:#050506;padding:18px 26px;color:#c7c9c7;font-size:13px">DETAILX LA / Premium Mobile Detailing in Los Angeles</div>
        </div>
      </div>
    `,
    replyTo: getBusinessEmail(),
  });
}

async function sendEmail(message: {
  label: string;
  to: string;
  subject: string;
  html: string;
  replyTo: string;
}) {
  const resend = getResendClient();
  const from = getResendFromEmail();

  console.info("Resend booking email config", {
    label: message.label,
    hasResendApiKey: Boolean(process.env.RESEND_API_KEY),
    from,
    to: message.to,
    businessEmail: getBusinessEmail(),
  });

  if (!resend) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const response = await resend.emails.send({
    from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    replyTo: message.replyTo,
  });

  console.info("Resend booking email response", {
    label: message.label,
    response,
  });

  if (response.error) {
    console.error("Resend booking email error", {
      label: message.label,
      error: response.error,
    });
    throw new Error(JSON.stringify(response.error));
  }

  return response.data;
}

function buildCustomerEmailHtml(booking: BookingEmail) {
  const businessEmail = getBusinessEmail();
  const calendarUrl = buildGoogleCalendarUrl(booking);
  const detailxImageUrl = getPublicAssetUrl("/brand/detailx-work/black-porsche-studio.jpg");
  const detailItems = getEmailDetailItems(booking);
  const notes = detailItems.flatMap((detail) => detail.notes ? [`Detail ${detail.lineNumber}: ${detail.notes}`] : []);

  return `
    <div style="margin:0;background:#f1f1ee;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#050506;line-height:1.5">
      <div style="max-width:680px;margin:0 auto">
        <div style="background:#050506;border-radius:8px 8px 0 0;padding:30px 26px;color:#ffffff">
          <p style="margin:0;color:#c1121f;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase">DETAILX LA</p>
          <h1 style="margin:12px 0 0;font-size:34px;line-height:0.96;text-transform:uppercase">Booking Confirmed</h1>
          <p style="margin:14px 0 0;color:#c7c9c7;font-size:16px">Thanks for booking with DETAILX LA. Your appointment request has been received.</p>
        </div>
        <div style="background:#ffffff;border:1px solid #e2e2dc;border-top:0;padding:24px">
          <div style="border:1px solid #e4e4df;border-radius:8px;overflow:hidden;background:#ffffff">
            <div style="background:#f7f7f3;padding:14px 16px;border-bottom:1px solid #e4e4df">
              <p style="margin:0;color:#73777c;font-size:11px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase">Booking summary</p>
            </div>
            ${detailItems.map(buildEmailDetailRow).join("")}
            ${buildSummaryLine("Date", booking.date)}
            ${buildSummaryLine("Time", booking.time)}
            ${buildSummaryLine("Location", booking.address)}
            ${booking.carModel ? buildSummaryLine(getAssetSummaryLabel(booking.service), booking.carModel) : ""}
            ${hasFreeWaxBonus(detailItems) ? buildSummaryLine("Bonus", freeWaxBonusLabel) : ""}
            ${notes.length ? buildSummaryLine("Notes", notes.join(" | ")) : ""}
            ${buildSummaryLine("Estimated total", booking.estimatedPrice || "Estimate pending", true)}
          </div>
          <div style="margin-top:24px;text-align:center">
            <a href="${escapeHtml(calendarUrl)}" style="display:inline-block;border-radius:8px;background:#c1121f;color:#ffffff;font-size:13px;font-weight:900;letter-spacing:0.06em;text-decoration:none;text-transform:uppercase;padding:15px 22px">Add to Google Calendar</a>
          </div>
          <div style="margin-top:24px;border-radius:8px;overflow:hidden;background:#050506">
            <img src="${escapeHtml(detailxImageUrl)}" alt="DETAILX LA work" width="632" style="display:block;width:100%;max-width:100%;height:auto;border:0" />
          </div>
        </div>
        <div style="background:#050506;border-radius:0 0 8px 8px;padding:22px 26px;color:#c7c9c7;font-size:13px">
          <p style="margin:0 0 8px;color:#ffffff;font-size:16px;font-weight:900;text-transform:uppercase">Thank you for trusting DETAILX LA.</p>
          <p style="margin:0">Premium Mobile Detailing in Los Angeles</p>
          <p style="margin:10px 0 0"><a style="color:#ffffff" href="mailto:${escapeHtml(businessEmail)}">${escapeHtml(businessEmail)}</a></p>
        </div>
      </div>
    </div>
  `;
}

function buildBusinessEmailHtml(booking: BookingEmail) {
  const detailItems = getEmailDetailItems(booking);
  const notes = detailItems.flatMap((detail) => detail.notes ? [`Detail ${detail.lineNumber}: ${detail.notes}`] : []);

  return `
    <div style="margin:0;background:#f1f1ee;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#050506;line-height:1.5">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e4e4df;border-radius:8px;overflow:hidden">
        <div style="background:#050506;color:#ffffff;padding:28px 26px">
          <p style="margin:0;color:#c1121f;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase">New DETAILX booking</p>
          <h1 style="margin:12px 0 0;font-size:30px;line-height:1;text-transform:uppercase">${detailItems.length} detail${detailItems.length > 1 ? "s" : ""}</h1>
          <p style="margin:12px 0 0;color:#c7c9c7;font-size:16px;font-weight:800">${escapeHtml(booking.date)} at ${escapeHtml(booking.time)} / ${escapeHtml(booking.estimatedPrice || "Estimate pending")}</p>
        </div>
        <div style="padding:24px">
          <div style="margin-bottom:18px;border:1px solid #e4e4df;border-radius:8px;background:#f7f7f3;padding:16px">
            <p style="margin:0;color:#73777c;font-size:11px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase">Customer</p>
            <p style="margin:6px 0 0;font-size:18px;font-weight:900">${escapeHtml(booking.name)}</p>
            <p style="margin:4px 0 0;color:#73777c;font-size:14px;font-weight:700">${escapeHtml(booking.phone)} / <a style="color:#c1121f;font-weight:800" href="mailto:${escapeHtml(booking.email)}">${escapeHtml(booking.email)}</a></p>
          </div>
          <div style="border:1px solid #e4e4df;border-radius:8px;overflow:hidden">
            ${detailItems.map(buildEmailDetailRow).join("")}
            ${buildSummaryLine("Date", booking.date)}
            ${buildSummaryLine("Time", booking.time)}
            ${buildSummaryLine("Location", booking.address)}
            ${booking.carModel ? buildSummaryLine(getAssetSummaryLabel(booking.service), booking.carModel) : ""}
            ${hasFreeWaxBonus(detailItems) ? buildSummaryLine("Bonus", freeWaxBonusLabel) : ""}
            ${notes.length ? buildSummaryLine("Notes", notes.join(" | ")) : ""}
            ${buildSummaryLine("Estimated total", booking.estimatedPrice || "Estimate pending", true)}
          </div>
        </div>
        <div style="border-top:1px solid #e4e4df;background:#050506;padding:18px 26px;color:#c7c9c7;font-size:13px">
          DETAILX LA<br />Premium Mobile Detailing in Los Angeles<br />Booking ID: ${booking.id}
        </div>
      </div>
    </div>
  `;
}

function getPublicAssetUrl(path: string) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://detailxla.com";
  return `${siteUrl.replace(/\/$/, "")}${path}`;
}

function buildGoogleCalendarUrl(booking: BookingEmail) {
  const start = buildGoogleDateTime(booking.date, booking.time, 0);
  const end = buildGoogleDateTime(booking.date, booking.time, 2);
  const detailItems = getEmailDetailItems(booking);
  const details = [
    ...detailItems.map((detail) => `Detail ${detail.lineNumber}: ${detail.service} / ${detail.vehicleType} / ${detail.estimatedPrice}`),
    ...(booking.carModel ? [`${getAssetSummaryLabel(booking.service)}: ${booking.carModel}`] : []),
    ...(hasFreeWaxBonus(detailItems) ? [`Bonus: ${freeWaxBonusLabel}`] : []),
    `Estimated price: ${booking.estimatedPrice || "Estimate pending"}`,
    `Booking ID: ${booking.id}`,
  ].join("\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `DETAILX LA - ${booking.service}`,
    dates: `${start}/${end}`,
    details,
    location: booking.address,
    ctz: "America/Los_Angeles",
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function getEmailDetailItems(booking: BookingEmail) {
  const details = booking.details?.length
    ? booking.details
    : [{ service: booking.service, vehicleType: booking.vehicleType, notes: booking.notes }];

  return buildBookingEstimate(details).details;
}

function buildEmailDetailRow(detail: ReturnType<typeof getEmailDetailItems>[number]) {
  return `
    <div style="border-bottom:1px solid #e4e4df;padding:16px">
      <p style="margin:0;color:#73777c;font-size:11px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase">Detail ${detail.lineNumber}</p>
      <p style="margin:6px 0 0;color:#050506;font-size:17px;font-weight:900">${escapeHtml(detail.service)} / ${escapeHtml(formatDetailAsset(detail.service, detail.vehicleType))}</p>
      <p style="margin:4px 0 0;color:#c1121f;font-size:14px;font-weight:900">${escapeHtml(detail.estimatedPrice)}</p>
    </div>
  `;
}

function buildSummaryLine(label: string, value: string, strong = false) {
  return `
    <div style="border-bottom:1px solid #e4e4df;padding:16px;background:${strong ? "#050506" : "#ffffff"}">
      <p style="margin:0;color:#73777c;font-size:11px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase">${escapeHtml(label)}</p>
      <p style="margin:6px 0 0;color:${strong ? "#ffffff" : "#050506"};font-size:${strong ? "22px" : "15px"};font-weight:${strong ? "900" : "700"}">${escapeHtml(value)}</p>
    </div>
  `;
}

function getAssetSummaryLabel(service: string) {
  return isBoatDetailingService(service) ? "Boat size / length" : "Car make/model";
}

function formatDetailAsset(service: string, asset: string) {
  return isBoatDetailingService(service) ? getDisplayAssetLabel(service) : asset;
}

function buildGoogleDateTime(dateValue: string, timeValue: string, addHours: number) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const match = timeValue.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  let hour = 9;
  let minute = 0;

  if (match) {
    hour = Number(match[1]);
    minute = Number(match[2] || "0");
    const period = match[3].toUpperCase();

    if (period === "PM" && hour !== 12) {
      hour += 12;
    }

    if (period === "AM" && hour === 12) {
      hour = 0;
    }
  }

  const date = new Date(year, month - 1, day, hour + addHours, minute, 0);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatEmailMessage(value: string) {
  return escapeHtml(value)
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => `<p style="margin:0 0 12px">${line}</p>`)
    .join("");
}
