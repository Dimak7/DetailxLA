import twilio from "twilio";
import { secret, siteUrl } from "@/lib/platform/settings";
import { AppError } from "@/lib/platform/auth";
import { apiError } from "@/lib/platform/http";
import { query } from "@/lib/platform/db";
import { optOut } from "@/lib/platform/campaigns";
export async function POST(request: Request) {
  try {
    const token = await secret("sms_token");
    if (!token) throw new AppError("SMS is not connected.", 503);
    const params = Object.fromEntries(
      new URLSearchParams(await request.text()),
    );
    const u = new URL(request.url),
      url = siteUrl() + u.pathname + u.search;
    if (
      !twilio.validateRequest(
        token,
        request.headers.get("x-twilio-signature") || "",
        url,
        params,
      )
    )
      throw new AppError("Invalid SMS signature.", 403);
    if (
      /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPTOUT)$/i.test(
        params.Body?.trim() || "",
      ) ||
      params.OptOutType === "STOP"
    )
      await optOut(params.From);
    if (params.MessageSid && params.MessageStatus) {
      const mapped: Record<string, string> = {
        delivered: "delivered",
        undelivered: "failed",
        failed: "failed",
        sent: "sent",
        queued: "sent",
      };
      if (mapped[params.MessageStatus])
        await query(
          "UPDATE wl.messages SET status=$2,error=$3 WHERE provider_id=$1 AND status<>'delivered'",
          [
            params.MessageSid,
            mapped[params.MessageStatus],
            params.ErrorCode ? "SMS provider error " + params.ErrorCode : "",
          ],
        );
    }
    return new Response("<Response/>", {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (e) {
    return apiError(e);
  }
}
