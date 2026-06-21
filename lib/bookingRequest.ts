import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertFutureDate, bookingSchema } from "./bookingSchema";
import { saveBooking } from "./bookingStore";
import { sendBookingNotifications } from "./notifications";
import { buildBookingEstimate } from "./pricing";
import { getPricedServices } from "./servicePricingStore";
import { sendTelegramBookingNotification } from "./telegram";

export async function handleBookingRequest(request: Request) {
  try {
    const body = await request.json();
    const booking = bookingSchema.parse(body);
    assertFutureDate(booking.date);
    const pricedServices = await getPricedServices();
    const bookingDetails = booking.details?.length
      ? booking.details
      : [{ service: booking.service, vehicleType: booking.vehicleType, notes: booking.notes }];
    const bookingEstimate = buildBookingEstimate(bookingDetails, pricedServices);
    const [primaryDetail] = bookingDetails;
    const pricedBooking = {
      ...booking,
      service: primaryDetail.service,
      vehicleType: primaryDetail.vehicleType,
      notes: primaryDetail.notes || booking.notes,
      estimatedPrice: bookingEstimate.estimatedPrice,
      details: bookingEstimate.details,
    };

    const savedBooking = await saveBooking(pricedBooking);
    console.info("Booking saved", {
      bookingId: savedBooking.id,
      date: savedBooking.date,
      time: savedBooking.time,
      status: savedBooking.status,
    });
    const notifications = await sendBookingNotifications(savedBooking);
    const telegram = await sendTelegramBookingNotification(savedBooking);
    const emailWarning =
      notifications.email === "skipped"
        ? "Booking saved. Email confirmations were skipped because Resend is not configured."
        : notifications.email === "failed"
          ? "Booking saved. Email confirmations could not be sent."
          : null;
    const bookingStatus =
      notifications.email === "sent"
        ? "booking_saved_email_sent"
        : notifications.email === "failed"
          ? "booking_saved_email_failed"
          : "booking_saved_email_skipped";

    return NextResponse.json(
      {
        ok: true,
        status: bookingStatus,
        bookingId: savedBooking.id,
        emailSent: notifications.email === "sent",
        telegramSent: telegram === "sent",
        estimatedPrice: savedBooking.estimatedPrice,
        notifications: {
          ...notifications,
          telegram,
        },
        warning: emailWarning,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          ok: false,
          status: "booking_failed",
          error: error.issues[0]?.message || "Invalid booking details.",
        },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message === "Choose a future booking date.") {
      return NextResponse.json({ ok: false, status: "booking_failed", error: error.message }, { status: 400 });
    }

    if (error instanceof Error && error.message.includes("time is no longer available")) {
      return NextResponse.json({ ok: false, status: "slot_unavailable", error: error.message }, { status: 409 });
    }

    console.error("Booking request failed", error);
    return NextResponse.json(
      {
        ok: false,
        status: "booking_failed",
        error: "We could not save the booking request. Please try again.",
      },
      { status: 500 }
    );
  }
}
