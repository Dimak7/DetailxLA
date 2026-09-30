type SavedBooking = {
  booking_id: string;
  confirmation_url: string;
  deposit_cents: number;
};

/** Once a booking exists, a checkout outage must still lead to its saved receipt. */
export async function bookingDestination(
  booking: SavedBooking,
  origin: string,
  request: typeof fetch = fetch,
) {
  const confirmation = new URL(booking.confirmation_url, origin);
  if (booking.deposit_cents <= 0) return confirmation.toString();
  const checkoutRequest = new AbortController();
  const timeout = setTimeout(() => checkoutRequest.abort(), 15_000);
  try {
    const response = await request("/api/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: booking.booking_id,
        token: confirmation.searchParams.get("token"),
        kind: "deposit",
      }),
      signal: checkoutRequest.signal,
    });
    const checkout = await response.json();
    if (response.ok && typeof checkout.url === "string" && checkout.url)
      return checkout.url;
  } catch {
    // The booking has already succeeded. Its receipt offers a safe next step.
  } finally {
    clearTimeout(timeout);
  }
  confirmation.searchParams.set("payment", "unavailable");
  return confirmation.toString();
}
