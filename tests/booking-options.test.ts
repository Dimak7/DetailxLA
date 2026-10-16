import test from "node:test";
import assert from "node:assert/strict";
import {
  bookingAddOns,
  bookingSelection,
  bookingCartSelection,
  defaultServicePackage,
  servicePackages,
  vehicleSizeLabel,
} from "../lib/booking-options";
import { money, type Service } from "../lib/platform/types";

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
  assert.equal(selected.addOnCents, 21000);
  assert.equal(selected.totalCents, 48500);
  assert.throws(() => bookingSelection(service("interior-detail"), "Sedan", "", ["engine-bay"]), /valid upgrades/i);
});

test("package selection can remain quote-based without inventing a total", () => {
  const correction = { ...service("paint-correction", 52500), pricing_mode: "starting" as const };
  assert.equal(bookingSelection(correction, "Sedan", "correction-level-2").totalCents, 75000);
  assert.equal(bookingSelection(correction, "Sedan", "correction-level-3").totalCents, null);
  assert.equal(vehicleSizeLabel("interior-detail", "SUV"), "Mid Size");
  assert.equal(vehicleSizeLabel("full-detail", "Truck"), "XL");
  assert.equal(vehicleSizeLabel("full-detail", ""), "Choose a size");
});

test("currency formatting preserves real cents without adding unnecessary zeros", () => {
  assert.equal(money(56500), "$565");
  assert.equal(money(28250), "$282.50");
});

test("multiple services combine server prices, size adjustments and duration", () => {
  const full = { ...service("full-detail", 50000), duration_minutes: 240 };
  const interior = { ...service("interior-detail", 30000), id: "00000000-0000-4000-8000-000000000002", duration_minutes: 180 };
  const cart = bookingCartSelection([full, interior], "SUV", [
    { service_id: full.id, addons: ["engine-bay"] },
    { service_id: interior.id, addons: ["car-seat"] },
  ]);
  assert.equal(cart.items.length, 2);
  assert.equal(cart.totalCents, 92000);
  assert.equal(cart.durationMinutes, 420);
  assert.equal(cart.requiresQuote, false);
});

test("ceramic anywhere in a cart requires consultation and unknown quotes keep the total unknown", () => {
  const full = service("full-detail", 50000);
  const ceramic = { ...service("ceramic-coating"), id: "00000000-0000-4000-8000-000000000002" };
  for (const order of [[full, ceramic], [ceramic, full]]) {
    const cart = bookingCartSelection(order, "Sedan", order.map((item) => ({ service_id: item.id })));
    assert.equal(cart.totalCents, 105000);
    assert.equal(cart.requiresQuote, true);
  }
  const correction = { ...service("paint-correction"), id: ceramic.id };
  const cart = bookingCartSelection([full, correction], "Sedan", [
    { service_id: full.id }, { service_id: correction.id, service_package: "correction-level-3" },
  ]);
  assert.equal(cart.totalCents, null);
  assert.equal(cart.requiresQuote, true);
});

test("cart rejects duplicate services, duplicate upgrades, unavailable services and double charged service upgrades", () => {
  const exterior = service("exterior-detail");
  const correction = { ...service("paint-correction"), id: "00000000-0000-4000-8000-000000000002" };
  assert.throws(() => bookingCartSelection([exterior], "Sedan", [{ service_id: exterior.id }, { service_id: exterior.id }]), /each service only once/);
  assert.throws(() => bookingCartSelection([exterior, correction], "Sedan", [
    { service_id: exterior.id, addons: ["trim-restoration"] }, { service_id: correction.id, addons: ["trim-restoration"] },
  ]), /only once/);
  assert.throws(() => bookingCartSelection([{ ...exterior, active: false }], "Sedan", [{ service_id: exterior.id }]), /no longer available/);
  const headlight = { ...correction, slug: "headlight-restoration" };
  assert.throws(() => bookingCartSelection([exterior, headlight], "Sedan", [
    { service_id: exterior.id, addons: ["headlight-restoration"] }, { service_id: headlight.id },
  ]), /already selected as a service/);
  assert.throws(() => bookingCartSelection([exterior], "Sedan", [{ service_id: exterior.id, service_package: "invalid" }]), /valid service package/);
});


test("approved upgrades show pair pricing, six-month sealant and explicit quotes", () => {
  const full = bookingAddOns("full-detail");
  assert.equal(full.find((item) => item.id === "ceramic-sealant")?.priceCents, 15000);
  assert.match(full.find((item) => item.id === "ceramic-sealant")!.description, /up to 6 months/);
  assert.equal(full.find((item) => item.id === "engine-bay")?.priceCents, 6000);
  assert.equal(full.find((item) => item.id === "headlight-restoration")?.priceCents, 15000);
  assert.match(full.find((item) => item.id === "headlight-restoration")!.description, /both headlights/i);
  for (const id of ["ozone", "tar-removal", "iron-removal"]) {
    assert.equal(full.find((item) => item.id === id)?.priceCents, null);
    const selected = bookingCartSelection([service("full-detail")], "Sedan", [{ service_id: service("full-detail").id, addons: [id, "engine-bay"] }]);
    assert.equal(selected.totalCents, null);
    assert.equal(selected.requiresQuote, true);
    assert.equal(selected.knownCents, 31000);
  }
  for (const slug of ["full-detail", "exterior-detail", "interior-detail", "ceramic-coating", "paint-correction"]) {
    assert.ok(bookingAddOns(slug).every((item) => !["decontamination", "scratch-removal"].includes(item.id)));
  }
  assert.throws(() => bookingSelection(service("full-detail"), "Sedan", "", ["decontamination"]), /valid upgrades/);
  assert.throws(() => bookingSelection(service("exterior-detail"), "Sedan", "", ["scratch-removal"]), /valid upgrades/);
});
