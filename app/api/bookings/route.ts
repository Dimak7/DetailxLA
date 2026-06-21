import { handleBookingRequest } from "@/lib/bookingRequest";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleBookingRequest(request);
}
