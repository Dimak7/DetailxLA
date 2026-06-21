import { NextResponse } from "next/server";
import { adminUnauthorizedResponse, isAdminRequest } from "@/lib/adminAuth";
import { getBookingById, updateBookingSchedule, updateBookingStatus, createScheduleBlock, deleteScheduleBlock, updateScheduleBlock, type BookingStatus } from "@/lib/bookingStore";
import { updateBusinessMetricsSettings } from "@/lib/businessMetricsStore";
import { sendClientPromotionEmail, sendCustomerBookingConfirmation } from "@/lib/resend";
import { createStripeInvoiceForBooking, updateInvoiceStatus, type InvoiceStatus } from "@/lib/invoiceStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bookingStatuses = ["pending", "confirmed", "cancelled", "completed"] as const;
const invoiceStatuses = ["draft", "sent", "paid", "overdue", "cancelled"] as const;

export async function POST(request: Request) {
  if (!isAdminRequest(request)) {
    return adminUnauthorizedResponse();
  }

  const formData = await request.formData();
  const action = String(formData.get("action") || "");
  const returnTo = String(formData.get("returnTo") || "/admin/dashboard");
  let handled = false;
  let adminMessage = "Admin update saved.";
  let adminData: Record<string, string> = {};
  const jsonResponse = wantsJsonResponse(request);

  try {
    if (action === "update-booking-status") {
      handled = true;
      const bookingId = String(formData.get("bookingId") || "");
      const status = String(formData.get("status") || "") as BookingStatus;
      console.info("Admin booking status action started", { bookingId, status });
      if (!bookingStatuses.includes(status)) {
        throw new Error("Choose a valid booking status.");
      }
      await updateBookingStatus(bookingId, status);
      console.info("Admin booking status action completed", { bookingId, status });
      adminMessage = `Booking marked ${status}.`;
    }

    if (action === "reschedule-booking") {
      handled = true;
      const bookingId = String(formData.get("bookingId") || "");
      const date = String(formData.get("date") || "");
      const time = String(formData.get("time") || "");
      console.info("Admin booking reschedule action started", { bookingId, date, time });
      await updateBookingSchedule(bookingId, {
        date,
        time,
      });
      console.info("Admin booking reschedule action completed", { bookingId, date, time });
      adminMessage = "Booking rescheduled.";
    }

    if (action === "resend-email") {
      handled = true;
      const bookingId = String(formData.get("bookingId") || "");
      console.info("Admin booking resend email started", { bookingId });
      const booking = await getBookingById(bookingId);
      if (!booking) {
        throw new Error("Booking was not found.");
      }
      await sendCustomerBookingConfirmation(booking);
      console.info("Admin booking resend email completed", { bookingId });
      adminMessage = "Confirmation email resent.";
    }

    if (action === "block-slot") {
      handled = true;
      console.info("Admin block slot action started", {
        date: String(formData.get("date") || ""),
        startTime: String(formData.get("startTime") || formData.get("time") || ""),
        endTime: String(formData.get("endTime") || ""),
      });
      await createScheduleBlock({
        date: String(formData.get("date") || ""),
        startTime: String(formData.get("startTime") || formData.get("time") || ""),
        endTime: String(formData.get("endTime") || ""),
        reason: String(formData.get("reason") || "Unavailable"),
      });
      console.info("Admin block slot action completed", { date: String(formData.get("date") || "") });
      adminMessage = "Time range blocked.";
    }

    if (action === "update-block") {
      handled = true;
      const blockId = String(formData.get("blockId") || "");
      console.info("Admin update block action started", { blockId });
      await updateScheduleBlock(blockId, {
        date: String(formData.get("date") || ""),
        startTime: String(formData.get("startTime") || ""),
        endTime: String(formData.get("endTime") || ""),
        reason: String(formData.get("reason") || "Unavailable"),
      });
      console.info("Admin update block action completed", { blockId });
      adminMessage = "Time block updated.";
    }

    if (action === "remove-block") {
      handled = true;
      console.info("Admin remove block action started", { blockId: String(formData.get("blockId") || "") });
      await deleteScheduleBlock(String(formData.get("blockId") || ""));
      console.info("Admin remove block action completed", { blockId: String(formData.get("blockId") || "") });
      adminMessage = "Time block removed.";
    }

    if (action === "create-invoice") {
      handled = true;
      const bookingId = String(formData.get("bookingId") || "");
      console.info("Admin invoice action started", { bookingId });
      const booking = await getBookingById(bookingId);
      if (!booking) {
        throw new Error("Booking was not found.");
      }
      console.info("Admin invoice booking loaded", { bookingId: booking.id });
      const invoiceResult = await createStripeInvoiceForBooking(booking);
      if (!invoiceResult.success) {
        throw new Error(invoiceResult.error || "Invoice could not be created. Check Stripe setup or booking data.");
      }
      console.info("Admin invoice action completed", {
        bookingId,
        invoiceId: invoiceResult.invoice.id,
        paymentUrl: invoiceResult.paymentUrl,
        emailSent: invoiceResult.emailSent,
        emailError: invoiceResult.emailError,
      });
      adminMessage = invoiceResult.emailSent
        ? "Invoice created and emailed to the customer."
        : "Invoice created, but the customer email could not be sent. Open the payment link and send it manually.";
      adminData = {
        invoiceId: invoiceResult.invoice.id,
        paymentUrl: invoiceResult.paymentUrl,
        emailSent: String(invoiceResult.emailSent),
        ...(invoiceResult.emailError ? { emailError: invoiceResult.emailError } : {}),
      };
    }

    if (action === "update-invoice-status") {
      handled = true;
      console.info("Admin invoice status action started", { invoiceId: String(formData.get("invoiceId") || "") });
      const status = String(formData.get("status") || "") as InvoiceStatus;
      if (!invoiceStatuses.includes(status)) {
        throw new Error("Choose a valid invoice status.");
      }
      await updateInvoiceStatus(String(formData.get("invoiceId") || ""), status);
      console.info("Admin invoice status action completed", { invoiceId: String(formData.get("invoiceId") || ""), status });
      adminMessage = "Invoice status updated.";
    }

    if (action === "send-client-promotion") {
      handled = true;
      const to = String(formData.get("email") || "").trim();
      const name = String(formData.get("name") || "").trim();
      const subject = String(formData.get("subject") || "").trim();
      const message = String(formData.get("message") || "").trim();
      const template = String(formData.get("template") || "Custom").trim();
      console.info("Admin client email action started", { to, template, hasSubject: Boolean(subject), hasMessage: Boolean(message) });
      console.info("Admin client email template selected", { template });

      if (!to || !isEmailAddress(to)) {
        throw new Error("Client email is missing or invalid.");
      }

      if (!name || !subject || !message) {
        throw new Error("Client name, subject, and message are required.");
      }

      try {
        console.info("Admin client email send started", { to, template });
        await sendClientPromotionEmail({ to, name, subject, message });
        console.info("Admin client email send success", { to, template });
      } catch (error) {
        console.error("Admin client email send failed", { to, template, error });
        throw new Error("Client email could not be sent. Check Resend setup and the client email address.");
      }

      adminMessage = "Client email sent.";
    }

    if (action === "update-business-metrics") {
      handled = true;
      const marketingExpense = Number(String(formData.get("marketingExpense") || "0").replace(/[^\d.]/g, ""));
      console.info("Admin business metrics update started", { marketingExpense });
      await updateBusinessMetricsSettings({ marketingExpense });
      console.info("Admin business metrics update completed", { marketingExpense });
      adminMessage = "Dashboard inputs updated.";
    }

    if (!handled) {
      throw new Error("Choose an admin action.");
    }

    const redirectUrl = new URL(withFlash(returnTo, "saved", adminMessage), request.url);
    console.info("Admin action final response returned", { action, redirectTo: `${redirectUrl.pathname}${redirectUrl.search}` });
    if (jsonResponse) {
      return NextResponse.json({ success: true, message: adminMessage, ...adminData });
    }

    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error) {
    console.error("Admin action failed", { action, error });
    const errorMessage = error instanceof Error && error.message
      ? error.message
      : getDefaultAdminActionError(action);
    const redirectUrl = new URL(withFlash(returnTo, "error", errorMessage), request.url);
    console.info("Admin action final response returned", { action, redirectTo: `${redirectUrl.pathname}${redirectUrl.search}`, failed: true });
    if (jsonResponse) {
      return NextResponse.json({ success: false, error: errorMessage });
    }

    return NextResponse.redirect(redirectUrl, { status: 303 });
  }
}

function wantsJsonResponse(request: Request) {
  return request.headers.get("accept")?.includes("application/json") || request.headers.get("x-admin-action") === "fetch";
}

function isEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getDefaultAdminActionError(action: string) {
  if (action === "send-client-promotion") {
    return "Client email could not be sent.";
  }

  if (action === "create-invoice") {
    return "Invoice could not be created. Check Stripe setup or booking data.";
  }

  return "Admin action could not be completed.";
}

function withFlash(path: string, status: "saved" | "error", message?: string) {
  const url = new URL(sanitizeReturnPath(path), "https://detailxla.com");
  url.searchParams.set("adminStatus", status);
  if (message) {
    url.searchParams.set("adminMessage", message);
  }
  return `${url.pathname}${url.search}`;
}

function sanitizeReturnPath(path: string) {
  if (!path) {
    return "/admin/dashboard";
  }

  try {
    const url = new URL(path, "https://detailxla.com");
    if (!url.pathname.startsWith("/admin")) {
      return "/admin/dashboard";
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return "/admin/dashboard";
  }
}
