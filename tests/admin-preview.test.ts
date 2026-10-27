import assert from "node:assert/strict";
import test from "node:test";
import { secret } from "../lib/platform/settings";
import { deliver, NotConnected } from "../lib/integrations/providers";
import type { Message } from "../lib/platform/types";

test("local preview ignores integration credentials and never sends messages", async () => {
  const before = { preview: process.env.ADMIN_PREVIEW, square: process.env.SQUARE_ACCESS_TOKEN };
  process.env.ADMIN_PREVIEW = "true";
  process.env.SQUARE_ACCESS_TOKEN = "test-placeholder-must-not-be-used";
  try {
    assert.equal(await secret("square_access_token"), "");
    assert.equal(await secret("email_key"), "");
    await assert.rejects(deliver({ channel: "email", recipient: "sample@example.test" } as Message), error => error instanceof NotConnected && /Local preview/.test(error.message));
  } finally {
    if (before.preview === undefined) delete process.env.ADMIN_PREVIEW; else process.env.ADMIN_PREVIEW = before.preview;
    if (before.square === undefined) delete process.env.SQUARE_ACCESS_TOKEN; else process.env.SQUARE_ACCESS_TOKEN = before.square;
  }
});
