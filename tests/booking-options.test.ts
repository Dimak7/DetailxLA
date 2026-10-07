import test from "node:test";
import assert from "node:assert/strict";
import {
  bookingAddOns,
  bookingSelection,
  defaultServicePackage,
  servicePackages,
  vehicleSizeLabel,
} from "../lib/booking-options";
import type { Service } from "../lib/platform/types";

function service(slug: string, price = 25000): Service {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: slug,
    slug,
    category: "Detailing",
    description: "",
    includes: [],
    price_cents: price,
    suv_extra_cents: 2500,
    truck_extra_cents: 5000,
    pricing_mode: "fixed",
    duration_minutes: 120,
    active: true,
    sort_order: 0,
    image_url: "",
  };
}

test("booking options use the approved service packages and relevant upgrades", () => {
  assert.equal(defaultServicePackage("ceramic-coating"), "ceramic-2-year");
  assert.deepEqual(servicePackages("paint-correction").map((item) => item.priceCents), [52500, 75000, null]);
  assert.ok(bookingAddOns("interior-detail").some((item) => item.id === "hair-removal"));
  assert.ok(!bookingAddOns("interior-detail").some((item) => item.id === "engine-bay"));
});

test("booking estimate includes vehicle size and validated upgrades", () => {
  const selected = bookingSelection(service("exterior-detail"), "SUV", "", ["ceramic-sealant", "engine-bay"]);
  assert.equal(selected.baseCents, 27500);
  assert.equal(selected.addOnCents, 10000);
  assert.equal(selected.totalCents, 37500);
  assert.throws(() => bookingSelection(service("interior-detail"), "Sedan", "", ["engine-bay"]), /valid upgrades/i);
});

test("package selection can remain quote-based without inventing a total", () => {
  const correction = { ...service("paint-correction", 52500), pricing_mode: "starting" as const };
  assert.equal(bookingSelection(correction, "Sedan", "correction-level-2").totalCents, 75000);
  assert.equal(bookingSelection(correction, "Sedan", "correction-level-3").totalCents, null);
  assert.equal(vehicleSizeLabel("interior-detail", "SUV"), "Mid Size");
  assert.equal(vehicleSizeLabel("full-detail", "Truck"), "XL");
});
