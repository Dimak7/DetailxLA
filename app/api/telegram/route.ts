import { NextResponse } from "next/server";
import { handleTelegramCallbackQuery, handleTelegramMessage } from "@/lib/telegram";

export const runtime = "nodejs";

type TelegramUpdate = {
  update_id?: number;
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      chat?: {
        id?: number | string;
      };
      message_id?: number;
    };
  };
  message?: {
    chat?: {
      id?: number | string;
    };
    text?: string;
  };
};

export async function POST(request: Request) {
  try {
    if (!isValidTelegramWebhookRequest(request)) {
      console.error("Telegram webhook rejected: invalid secret token.");
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const update = (await request.json()) as TelegramUpdate;
    console.info("Telegram update received", {
      updateId: update.update_id,
      hasCallbackQuery: Boolean(update.callback_query),
      hasMessage: Boolean(update.message),
    });

    if (update.callback_query) {
      const result = await handleTelegramCallbackQuery(update.callback_query);
      return NextResponse.json({ ok: result.ok, message: result.message });
    }

    if (update.message) {
      const result = await handleTelegramMessage(update.message);
      return NextResponse.json({ ok: result.ok, message: result.message });
    }

    return NextResponse.json({ ok: true, message: "No supported Telegram action." });
  } catch (error) {
    console.error("Telegram webhook failed", error);
    return NextResponse.json({ ok: false, error: "Telegram update failed." }, { status: 500 });
  }
}

function isValidTelegramWebhookRequest(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!secret) {
    console.warn("TELEGRAM_WEBHOOK_SECRET is not configured; Telegram webhook is relying on chat ID validation.");
    return true;
  }

  return request.headers.get("x-telegram-bot-api-secret-token") === secret;
}
