import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { adminAction } from "../lib/platform/admin";
import { saveAttribution } from "../lib/platform/attribution";
import { closeDatabase, query, transaction } from "../lib/platform/db";
import type { Session } from "../lib/platform/types";

Object.assign(process.env, { NODE_ENV: "test", PGLITE_PATH: "memory://lead-attribution-edit" });
for (const key of ["DATABASE_URL", "RAILWAY_ENVIRONMENT", "ADMIN_EMAIL", "ADMIN_PASSWORD", "SQUARE_ACCESS_TOKEN", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "TELEGRAM_BOT_TOKEN", "TWILIO_AUTH_TOKEN"]) delete process.env[key];

test("editing a lead preserves advertising evidence unless its source is explicitly changed", async () => {
  try {
    const userId = randomUUID(), id = randomUUID();
    await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'Owner','owner@example.test','unused','owner')", [userId]);
    const user: Session = { id: "fixture", user_id: userId, name: "Owner", email: "owner@example.test", role: "owner" };
    const attributionId = await transaction(q => saveAttribution(q, randomUUID(), {
      source: "google", medium: "cpc", campaign: "paint-correction", gclid: "original-ad-click",
      lead_stream: "Business Google · 10%", landing_page: "/services/paint-correction", referrer: "https://google.com/",
    }));
    await query("INSERT INTO wl.leads(id,name,email,phone,attribution_id) VALUES($1,'Prospect','prospect@example.test','3125550100',$2)", [id, attributionId]);
    const payload = { id, name: "Prospect", email: "prospect@example.test", phone: "3125550100", status: "contacted", notes: "Discussed paint correction", source: "Google Ads", lead_stream: "Business Google · 10%", campaign: "paint-correction", assigned_to: null };
    await adminAction("save_lead", payload, user);
    const [preserved] = await query<{ attribution_id: string; gclid: string; landing_page: string; medium: string }>("SELECT l.attribution_id,a.gclid,a.landing_page,a.medium FROM wl.leads l JOIN wl.attributions a ON a.id=l.attribution_id WHERE l.id=$1", [id]);
    assert.equal(preserved.attribution_id, attributionId);
    assert.equal(preserved.gclid, "original-ad-click");
    assert.equal(preserved.landing_page, "/services/paint-correction");
    assert.equal(preserved.medium, "cpc");
    await adminAction("save_lead", { ...payload, source: "Phone", lead_stream: "Unassigned", campaign: "" }, user);
    const [changed] = await query<{ attribution_id: string; source: string; gclid: string }>("SELECT l.attribution_id,a.source,a.gclid FROM wl.leads l JOIN wl.attributions a ON a.id=l.attribution_id WHERE l.id=$1", [id]);
    assert.notEqual(changed.attribution_id, attributionId);
    assert.equal(changed.source, "Phone");
    assert.equal(changed.gclid, "");
  } finally { await closeDatabase(); }
});
