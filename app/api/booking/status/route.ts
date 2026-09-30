import { NextResponse, after } from "next/server";
import { z } from "zod";
import { AppError, assertOrigin, rateLimit, requestIP, verifyReceipt } from "@/lib/platform/auth";
import { apiError, readJson } from "@/lib/platform/http";
import { bookingReceipt } from "@/lib/platform/receipts";
import { reconcileSquareBookingPayment } from "@/lib/integrations/payments";
import { processOutbox } from "@/lib/platform/worker";

export const runtime = "nodejs";
const input = z.object({id:z.uuid(),token:z.string().regex(/^[a-f0-9]{64}$/)});
const noStore = {"Cache-Control":"private, no-store"};

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    let updated = false;
    // Register before database awaits: embedded adapters can lose request context.
    after(async () => {
      if (updated) await processOutbox(10).catch(() => {});
    });
    await rateLimit("booking-status:" + requestIP(request),60,60);
    const {id,token} = input.parse(await readJson(request));
    if (!(await verifyReceipt(id,token))) throw new AppError("Invalid receipt link.",403);
    let verificationUnavailable = false;
    try {
      updated = await reconcileSquareBookingPayment(id);
    } catch {
      // Provider failures never mean unpaid, and provider errors can contain secrets.
      verificationUnavailable = true;
    }
    const receipt = await bookingReceipt(id);
    if (!receipt) throw new AppError("Appointment not found.",404);
    return NextResponse.json({ok:true,receipt,...(verificationUnavailable ? {verificationUnavailable:true} : {})},{headers:noStore});
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control",noStore["Cache-Control"]);
    return response;
  }
}
