import test from "node:test";
import assert from "node:assert/strict";
import { layoutOverlappingShifts } from "../lib/platform/schedule-layout";

test("overlapping shift layout", async (t) => {
  await t.test("gives four concurrent employees separate lanes", () => {
    const layout = layoutOverlappingShifts([
      { id: "mike", start_minute: 540, end_minute: 1020 },
      { id: "josh", start_minute: 600, end_minute: 1200 },
      { id: "mark", start_minute: 600, end_minute: 1080 },
      { id: "alex", start_minute: 660, end_minute: 1140 },
    ]);
    assert.deepEqual(layout.map(({ lanes }) => lanes), [4, 4, 4, 4]);
    assert.deepEqual(layout.map(({ lane }) => lane).sort(), [0, 1, 2, 3]);
  });

  await t.test("supports six simultaneous shifts", () => {
    const layout = layoutOverlappingShifts(
      Array.from({ length: 6 }, (_, index) => ({
        id: String(index),
        start_minute: 600,
        end_minute: 960,
      })),
    );
    assert.deepEqual(layout.map(({ lane, lanes }) => [lane, lanes]), [
      [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
    ]);
  });

  await t.test("reuses a freed lane for partial overlaps", () => {
    const layout = layoutOverlappingShifts([
      { id: "mike", start_minute: 540, end_minute: 720 },
      { id: "josh", start_minute: 540, end_minute: 1020 },
      { id: "mark", start_minute: 780, end_minute: 1080 },
    ]);
    assert.deepEqual(layout.map(({ shift, lane, lanes }) => [shift.id, lane, lanes]), [
      ["mike", 0, 2],
      ["josh", 1, 2],
      ["mark", 0, 2],
    ]);
  });
});
