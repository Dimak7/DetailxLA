import { NextResponse } from "next/server";
import { adminUnauthorizedResponse, isAdminRequest } from "@/lib/adminAuth";
import {
  createScheduleBlock,
  deleteScheduleBlock,
  getAvailability,
  listBookingsByDate,
  listScheduleBlocks,
  updateBookingStatus,
  updateScheduleBlock,
  type BookingStatus,
} from "@/lib/bookingStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return adminUnauthorizedResponse();
  }

  const url = new URL(request.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);

  return NextResponse.json({
    ok: true,
    date,
    availability: await getAvailability(date),
    bookings: await listBookingsByDate(date),
    blocks: await listScheduleBlocks(date),
  });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) {
    return adminUnauthorizedResponse();
  }

  try {
    const body = await request.json();
    const block = await createScheduleBlock({
      date: String(body.date || ""),
      startTime: String(body.startTime || body.time || ""),
      endTime: String(body.endTime || ""),
      reason: String(body.reason || "Unavailable"),
    });

    return NextResponse.json({ ok: true, block }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not block this time." },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  if (!isAdminRequest(request)) {
    return adminUnauthorizedResponse();
  }

  const body = await request.json();
  if (body.type === "block") {
    try {
      await updateScheduleBlock(String(body.id || ""), {
        date: String(body.date || ""),
        startTime: String(body.startTime || ""),
        endTime: String(body.endTime || ""),
        reason: String(body.reason || "Unavailable"),
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : "Could not update this block." },
        { status: 400 }
      );
    }
  }

  const id = String(body.id || "");
  const status = String(body.status || "") as BookingStatus;

  if (!id || !["pending", "confirmed", "cancelled", "completed"].includes(status)) {
    return NextResponse.json({ ok: false, error: "Choose a valid booking and status." }, { status: 400 });
  }

  try {
    await updateBookingStatus(id, status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not update booking status." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  if (!isAdminRequest(request)) {
    return adminUnauthorizedResponse();
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";

  if (!id) {
    return NextResponse.json({ ok: false, error: "Choose a block to remove." }, { status: 400 });
  }

  await deleteScheduleBlock(id);
  return NextResponse.json({ ok: true });
}
