import test from "node:test";
import assert from "node:assert/strict";
import { bookingDestination } from "../lib/booking-handoff";

const booking = { booking_id: "booking-id", confirmation_url: "/booking/confirmation?id=booking-id&token=private-token", deposit_cents: 2000 };

test("a saved booking without a deposit goes straight to its private confirmation", async () => {
  const destination = await bookingDestination({ ...booking, deposit_cents: 0 }, "https://example.test", async () => { throw Error("Checkout should not be requested"); });
  assert.equal(destination, "https://example.test" + booking.confirmation_url);
});

test("a deposit handoff uses the saved receipt credentials and hosted checkout", async () => {
  const destination = await bookingDestination(booking, "https://example.test", async (url, init) => {
    assert.equal(url, "/api/payment");
    assert.equal(init?.method, "POST");
    assert.ok(init?.signal);
    assert.deepEqual(JSON.parse(String(init?.body)), { id: "booking-id", token: "private-token", kind: "deposit" });
    return Response.json({ ok: true, url: "https://square.link/u/test-checkout" });
  });
  assert.equal(destination, "https://square.link/u/test-checkout");
});

test("checkout network, processor and malformed-response failures preserve the successful booking", async () => {
  const failures: typeof fetch[] = [
    async () => { throw Error("Network unavailable"); },
    async () => Response.json({ error: "Processor unavailable" }, { status: 503 }),
    async () => new Response("not-json"),
    async () => Response.json({ ok: true }),
  ];
  for (const request of failures) {
    const destination = new URL(await bookingDestination(booking, "https://example.test", request));
    assert.equal(destination.pathname, "/booking/confirmation");
    assert.equal(destination.searchParams.get("id"), booking.booking_id);
    assert.equal(destination.searchParams.get("token"), "private-token");
    assert.equal(destination.searchParams.get("payment"), "unavailable");
  }
});
