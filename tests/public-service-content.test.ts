import test from "node:test";
import assert from "node:assert/strict";
import { getServiceFaqs } from "../lib/service-content";
import type { Service } from "../lib/platform/types";

const correction: Service = {
  id: "correction",
  slug: "paint-correction",
  name: "Paint Correction",
  category: "Paint",
  description: "Machine polishing",
  includes: [],
  price_cents: 52500,
  suv_extra_cents: 2500,
  truck_extra_cents: 5000,
  pricing_mode: "starting",
  duration_minutes: 300,
  active: true,
  sort_order: 0,
  image_url: "",
};

test("public service answers follow live prices and appointment estimates", () => {
  const first = getServiceFaqs(correction);
  assert.match(first[0].answer, /starts at \$525 for a sedan/);
  assert.match(first[1].answer, /estimate is 5 hours/);
  assert.equal(first.filter((item) => item.question.startsWith("How long")).length, 1);

  const updated = getServiceFaqs({ ...correction, price_cents: 57550, duration_minutes: 330 });
  assert.match(updated[0].answer, /\$575\.50/);
  assert.match(updated[1].answer, /5 hours 30 min/);
  assert.doesNotMatch(updated[0].answer, /\$525/);
});

test("consultation services never present placeholder zero as a public price", () => {
  const questions = getServiceFaqs({ ...correction, pricing_mode: "quote", price_cents: 0, duration_minutes: 0 });
  assert.match(questions[0].answer, /priced by consultation/);
  assert.doesNotMatch(questions[0].answer, /\$0/);
  assert.equal(questions.some((item) => item.question.startsWith("How long")), false);
});

test("fixed service answers do not mislabel a listed price as a starting price", () => {
  const questions = getServiceFaqs({ ...correction, pricing_mode: "fixed" });
  assert.match(questions[0].answer, /is listed at \$525/);
  assert.doesNotMatch(questions[0].answer, /starts at/);
});
