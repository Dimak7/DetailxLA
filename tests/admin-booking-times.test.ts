import assert from "node:assert/strict";
import test from "node:test";
import { loadAdminBookingTimes, nextAdminBookingTime } from "../lib/admin-booking-times";

test("an old schedule response is ignored even when the transport completes after cancellation", async () => {
  const controller = new AbortController();
  let finish!: (value: Response) => void;
  const oldRequest = loadAdminBookingTimes("date=2026-11-02", controller.signal, () => new Promise(resolve => { finish = resolve; }));
  controller.abort();
  finish(Response.json({ ok: true, slots: [{ minute: 480, available: true }] }));
  assert.equal(await oldRequest, null);
});

test("a failed request for an old date does not replace the current date's availability", async () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(await loadAdminBookingTimes("date=2026-11-02", controller.signal, async () => Response.json({ ok: false, error: "Old request failed" }, { status: 400 })), null);
  const current = await loadAdminBookingTimes("date=2026-11-03", new AbortController().signal, async () => Response.json({ ok: true, slots: [{ minute: 600, available: true }] }));
  assert.deepEqual(current, [{ minute: 600, available: true }]);
});

test("availability errors and malformed results cannot become selectable times", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(loadAdminBookingTimes("", signal, async () => Response.json({ ok: false, error: "These services need more time." }, { status: 400 })), /These services need more time/);
  for (const slots of [undefined, null, [{ minute: "480", available: true }], [{ minute: 1440, available: true }], [{ minute: 480 }]])
    await assert.rejects(loadAdminBookingTimes("", signal, async () => Response.json({ ok: true, slots })), /Could not read/);
  assert.deepEqual(await loadAdminBookingTimes("", signal, async () => Response.json({ ok: true, slots: [] })), []);
});

test("walk-in defaults skip unavailable slots, retain earlier times for manual choice, and leave a full day unselected", () => {
  const slots = [{ minute: 480, available: true }, { minute: 600, available: false }, { minute: 630, available: true }];
  assert.equal(nextAdminBookingTime(slots, 612), 630);
  assert.equal(nextAdminBookingTime(slots, 630), 630);
  assert.equal(nextAdminBookingTime(slots, 645), -1);
  assert.equal(nextAdminBookingTime(slots, 660), -1);
  assert.equal(nextAdminBookingTime([{ minute: 480, available: false }], 480), -1);
  assert.deepEqual(slots[0], { minute: 480, available: true });
});
