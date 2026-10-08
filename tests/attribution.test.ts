import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAttribution } from "../lib/platform/attribution";

const attribution = (overrides: Record<string, string> = {}) => normalizeAttribution({
  source: "", lead_stream: "", medium: "", campaign: "", term: "", content: "",
  gclid: "", gbraid: "", wbraid: "", fbclid: "", landing_page: "", referrer: "",
  ...overrides,
});

test("paid ad channels require reliable paid signals while ordinary social clicks stay organic", () => {
  assert.equal(attribution({ gclid: "google-click" }).source, "Google Ads");
  assert.equal(attribution({ source: "facebook", fbclid: "social-click" }).source, "Organic Social");
  assert.equal(attribution({ source: "instagram", medium: "social" }).source, "Organic Social");
  assert.equal(attribution({ source: "facebook", medium: "paid_social", fbclid: "paid-click" }).source, "Meta Ads");
  assert.equal(attribution({ source: "Meta Ads" }).source, "Meta Ads");
});

test("lead stream aliases normalize independently from the ad channel", () => {
  assert.equal(attribution({ gclid: "one", lead_stream: "dima" }).lead_stream, "Dima Leads");
  assert.equal(attribution({ gclid: "two", lead_stream: "west-loop" }).lead_stream, "West Loop Leads");
  assert.equal(attribution({ gclid: "three", lead_stream: "unknown account" }).lead_stream, "Unassigned");
});
