import { revalidatePath } from "next/cache";
import { assertFutureDate, bookingServices, type BookingInput } from "./bookingSchema";
import { listBookingsByDate, listScheduleBlocks, saveBooking, type BookingStatus, type StoredBooking } from "./bookingStore";
import { buildBookingEstimate, freeWaxBonusLabel, getDisplayAssetLabel, getTelegramPriceLabel, hasFreeWaxBonus, isBoatDetailingService, vehicleTypes, type BookingService, type PricedService, type VehicleType } from "./pricing";
import { isTimeSlot, parseTimeSlotToMinutes, timeSlots, type TimeSlot } from "./schedule";
import { getPricedServices, updateServicePricing } from "./servicePricingStore";
import {
  clearTelegramManualSession,
  getTelegramManualSession,
  saveTelegramManualSession,
  type TelegramManualSession,
} from "./telegramManualStore";
import {
  clearTelegramPriceSession,
  getTelegramPriceSession,
  saveTelegramPriceSession,
  type TelegramPriceSession,
  type TelegramPriceUpdate,
} from "./telegramPriceStore";

type TelegramBooking = BookingInput & { id: string; status?: BookingStatus };

type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: {
    chat?: {
      id?: number | string;
    };
    message_id?: number;
  };
};

type TelegramMessage = {
  chat?: {
    id?: number | string;
  };
  text?: string;
};

export type TelegramNotificationStatus = "sent" | "skipped" | "failed";
export type TelegramActionResult = {
  ok: boolean;
  message: string;
};

export async function sendTelegramBookingNotification(booking: TelegramBooking): Promise<TelegramNotificationStatus> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  console.info("Telegram booking notification started", {
    bookingId: booking.id,
    hasBotToken: Boolean(botToken),
    hasChatId: Boolean(chatId),
  });

  if (!botToken || !chatId) {
    console.error("Telegram skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured.");
    return "skipped";
  }

  try {
    const response = await telegramApi("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: await buildTelegramBookingMessage(booking),
      reply_markup: {
        inline_keyboard: [
          [{ text: "\u2795 New Booking", callback_data: "manual_new" }],
          [{ text: "\ud83d\udcc5 Today Schedule", callback_data: "schedule_today" }],
          [{ text: "\ud83d\udcb5 Change Prices", callback_data: "prices_manage" }],
          [{ text: "Open Admin", url: buildAdminBookingUrl(booking) }],
        ],
      },
    });

    console.info("Telegram booking notification sent", {
      bookingId: booking.id,
      response,
    });
    return "sent";
  } catch (error) {
    console.error("Telegram booking notification failed", {
      bookingId: booking.id,
      error,
    });
    return "failed";
  }
}

export async function handleTelegramCallbackQuery(callbackQuery: TelegramCallbackQuery): Promise<TelegramActionResult> {
  const chatId = getChatId(callbackQuery.message?.chat?.id);
  const data = callbackQuery.data || "";
  console.info("Telegram action received", {
    callbackQueryId: callbackQuery.id,
    data,
    chatId,
  });

  try {
    if (!chatId) {
      await answerTelegramCallback(callbackQuery.id, "Missing Telegram chat.");
      return { ok: false, message: "Missing Telegram chat." };
    }

    if (data === "manual_new") {
      await startManualBooking(chatId);
      await answerTelegramCallback(callbackQuery.id, "New booking started.");
      return { ok: true, message: "New booking started." };
    }

    if (data === "manual_cancel") {
      await clearTelegramManualSession(chatId);
      await sendTelegramMessage(chatId, "Manual booking cancelled.");
      await answerTelegramCallback(callbackQuery.id, "Cancelled.");
      return { ok: true, message: "Manual booking cancelled." };
    }

    if (data === "manual_confirm") {
      const result = await confirmManualBooking(chatId);
      await answerTelegramCallback(callbackQuery.id, result.ok ? "Booking saved." : "Could not save booking.");
      return result;
    }

    if (data === "schedule_today") {
      console.info("Today Schedule button pressed", { chatId });
      await sendTodaySchedule(chatId);
      await answerTelegramCallback(callbackQuery.id, "Today schedule sent.");
      return { ok: true, message: "Today schedule sent." };
    }

    if (data === "prices_manage") {
      console.info("Change Prices button pressed", { chatId });
      if (!isAdminChat(chatId)) {
        await sendTelegramMessage(chatId, "You are not authorized to change prices.");
        await answerTelegramCallback(callbackQuery.id, "Not authorized.");
        return { ok: false, message: "Unauthorized Telegram price access." };
      }

      await startPriceManagement(chatId);
      await answerTelegramCallback(callbackQuery.id, "Choose a service.");
      return { ok: true, message: "Price management started." };
    }

    if (data.startsWith("prices_pick:")) {
      if (!isAdminChat(chatId)) {
        await sendTelegramMessage(chatId, "You are not authorized to change prices.");
        await answerTelegramCallback(callbackQuery.id, "Not authorized.");
        return { ok: false, message: "Unauthorized Telegram price access." };
      }

      const service = await getServiceFromCallbackCode(data.slice("prices_pick:".length));
      if (!service) {
        await answerTelegramCallback(callbackQuery.id, "Service not found.");
        return { ok: false, message: "Service not found." };
      }

      if (isNonFixedService(service)) {
        await promptForNonFixedService(chatId, service);
        await answerTelegramCallback(callbackQuery.id, "Non-fixed service selected.");
        return { ok: true, message: "Non-fixed service selected." };
      }

      await promptForServicePrice(chatId, service);
      await answerTelegramCallback(callbackQuery.id, "Send the new price.");
      return { ok: true, message: "Price prompt sent." };
    }

    if (data.startsWith("prices_override:")) {
      if (!isAdminChat(chatId)) {
        await sendTelegramMessage(chatId, "You are not authorized to change prices.");
        await answerTelegramCallback(callbackQuery.id, "Not authorized.");
        return { ok: false, message: "Unauthorized Telegram price access." };
      }

      const service = await getServiceFromCallbackCode(data.slice("prices_override:".length));
      if (!service) {
        await answerTelegramCallback(callbackQuery.id, "Service not found.");
        return { ok: false, message: "Service not found." };
      }

      await promptForServicePrice(chatId, service);
      await answerTelegramCallback(callbackQuery.id, "Send override price.");
      return { ok: true, message: "Override prompt sent." };
    }

    if (data.startsWith("prices_clear:")) {
      if (!isAdminChat(chatId)) {
        await sendTelegramMessage(chatId, "You are not authorized to change prices.");
        await answerTelegramCallback(callbackQuery.id, "Not authorized.");
        return { ok: false, message: "Unauthorized Telegram price access." };
      }

      const service = await getServiceFromCallbackCode(data.slice("prices_clear:".length));
      if (!service) {
        await answerTelegramCallback(callbackQuery.id, "Service not found.");
        return { ok: false, message: "Service not found." };
      }

      await updateServicePricing(service.title, { startingPrice: 0 });
      await clearTelegramPriceSession(chatId);
      revalidatePath("/");
      revalidatePath("/admin/bookings");
      revalidatePath("/admin/settings");
      console.info("Service price updated", {
        chatId,
        service: service.title,
        update: { startingPrice: 0 },
      });
      await sendTelegramMessage(chatId, "Service kept as non-fixed price.");
      await answerTelegramCallback(callbackQuery.id, "Kept non-fixed.");
      return { ok: true, message: "Service kept as non-fixed price." };
    }

    if (data === "prices_cancel") {
      await clearTelegramPriceSession(chatId);
      await sendTelegramMessage(chatId, "Price update cancelled.");
      await answerTelegramCallback(callbackQuery.id, "Cancelled.");
      return { ok: true, message: "Price update cancelled." };
    }

    if (data === "prices_confirm") {
      const result = await confirmPriceUpdate(chatId);
      await answerTelegramCallback(callbackQuery.id, result.ok ? "Price updated." : "Could not update price.");
      return result;
    }

    await answerTelegramCallback(callbackQuery.id, "Use the menu buttons.");
    return { ok: true, message: "No supported Telegram action." };
  } catch (error) {
    console.error("Telegram callback failed", { data, chatId, error });
    await answerTelegramCallback(callbackQuery.id, "Telegram action failed. Check server logs.");
    return { ok: false, message: "Telegram action failed." };
  }
}

export async function handleTelegramMessage(message: TelegramMessage): Promise<TelegramActionResult> {
  const chatId = getChatId(message.chat?.id);
  const text = (message.text || "").trim();

  if (!chatId || !text) {
    return { ok: true, message: "No Telegram text message." };
  }

  try {
    if (text.toLowerCase() === "/start" || text.toLowerCase() === "/help") {
      await sendTelegramStartMenu(chatId);
      return { ok: true, message: "Telegram start menu sent." };
    }

    if (text.toLowerCase() === "/newbooking" || text.toLowerCase() === "new booking") {
      await startManualBooking(chatId);
      return { ok: true, message: "Manual booking started." };
    }

    if (text.toLowerCase() === "/cancel") {
      await Promise.all([clearTelegramManualSession(chatId), clearTelegramPriceSession(chatId)]);
      await sendTelegramMessage(chatId, "Telegram action cancelled.");
      return { ok: true, message: "Telegram action cancelled." };
    }

    const priceSession = await getTelegramPriceSession(chatId);
    if (priceSession) {
      if (!isAdminChat(chatId)) {
        await clearTelegramPriceSession(chatId);
        await sendTelegramMessage(chatId, "You are not authorized to change prices.");
        return { ok: false, message: "Unauthorized Telegram price access." };
      }

      await processPriceInput(priceSession, text);
      return { ok: true, message: "Price input saved." };
    }

    const session = await getTelegramManualSession(chatId);
    if (!session) {
      return { ok: true, message: "No active Telegram session." };
    }

    await processManualBookingInput(session, text);
    return { ok: true, message: "Manual booking step saved." };
  } catch (error) {
    console.error("Telegram message handling failed", { chatId, error });
    await sendTelegramMessage(chatId, error instanceof Error ? error.message : "That did not work. Please try again.");
    return { ok: false, message: "Telegram message failed." };
  }
}

export async function sendDailyTelegramSchedule(date = getTodayLosAngelesDate()) {
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!chatId) {
    console.error("Daily Telegram schedule skipped: TELEGRAM_CHAT_ID is not configured.");
    return "skipped" as const;
  }

  try {
    await sendTodaySchedule(chatId, date);
    return "sent" as const;
  } catch (error) {
    console.error("Daily Telegram schedule failed", { date, error });
    return "failed" as const;
  }
}

async function startManualBooking(chatId: string) {
  await clearTelegramPriceSession(chatId);
  await saveTelegramManualSession({
    chatId,
    step: "name",
    data: {},
    updatedAt: new Date().toISOString(),
  });
  await sendTelegramMessage(chatId, "\u2795 <b>New DETAILX Booking</b>\n\nCustomer name?");
}

async function sendTelegramStartMenu(chatId: string) {
  await sendTelegramMessage(
    chatId,
    [
      "<b>DETAILX admin bot</b>",
      "",
      "Choose an action below.",
      "You can also send /newbooking anytime.",
    ].join("\n"),
    {
      inline_keyboard: [
        [{ text: "\u2795 New Booking", callback_data: "manual_new" }],
        [{ text: "\ud83d\udcc5 Today Schedule", callback_data: "schedule_today" }],
        [{ text: "\ud83d\udcb5 Change Prices", callback_data: "prices_manage" }],
      ],
    }
  );
}

async function processManualBookingInput(session: TelegramManualSession, text: string) {
  const nextSession: TelegramManualSession = {
    ...session,
    data: { ...session.data },
    updatedAt: new Date().toISOString(),
  };

  if (session.step === "name") {
    nextSession.data.name = requireMinText(text, "Customer name", 2);
    nextSession.step = "phone";
    await saveAndPrompt(nextSession, "Phone number?");
    return;
  }

  if (session.step === "phone") {
    nextSession.data.phone = requireMinText(text, "Phone number", 7);
    nextSession.step = "date";
    await saveAndPrompt(nextSession, "Date? Use YYYY-MM-DD.");
    return;
  }

  if (session.step === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      throw new Error("Use date format YYYY-MM-DD.");
    }
    assertFutureDate(text);
    nextSession.data.date = text;
    nextSession.step = "time";
    await saveAndPrompt(nextSession, `Time?\n\nAvailable starts:\n${timeSlots.join(", ")}`);
    return;
  }

  if (session.step === "time") {
    const time = normalizeTelegramTime(text);
    if (!time) {
      throw new Error(`Choose one of these times: ${timeSlots.join(", ")}`);
    }
    nextSession.data.time = time;
    nextSession.step = "service";
    await saveAndPrompt(nextSession, buildServicePrompt(await getPricedServices()));
    return;
  }

  if (session.step === "service") {
    const service = normalizeTelegramService(text, await getPricedServices());
    if (!service) {
      throw new Error("Choose a valid service number or name.");
    }
    nextSession.data.service = service;
    nextSession.step = "vehicleType";
    await saveAndPrompt(nextSession, isBoatDetailingService(service) ? "Asset type? Reply Boat." : "Vehicle type? Sedan, SUV, Truck, or Boat.");
    return;
  }

  if (session.step === "vehicleType") {
    const vehicleType = normalizeTelegramVehicle(text);
    if (!vehicleType) {
      throw new Error("Vehicle type must be Sedan, SUV, or Truck.");
    }
    nextSession.data.vehicleType = vehicleType;
    nextSession.step = "address";
    await saveAndPrompt(nextSession, "Address/location?");
    return;
  }

  if (session.step === "address") {
    nextSession.data.address = requireMinText(text, "Address/location", 5);
    nextSession.step = "notes";
    await saveAndPrompt(nextSession, "Notes? Type skip if none.");
    return;
  }

  if (session.step === "notes") {
    nextSession.data.notes = isSkip(text) ? "" : text.slice(0, 800);
    nextSession.step = "price";
    await saveAndPrompt(nextSession, "Price if available? Type skip to use the estimate.");
    return;
  }

  if (session.step === "price") {
    nextSession.data.price = isSkip(text) ? "" : normalizePrice(text);
    nextSession.step = "confirm";
    await saveTelegramManualSession(nextSession);
    await sendTelegramMessage(session.chatId, await buildManualBookingConfirmation(nextSession), {
      inline_keyboard: [[
        { text: "Confirm", callback_data: "manual_confirm" },
        { text: "Cancel", callback_data: "manual_cancel" },
      ]],
    });
  }
}

async function confirmManualBooking(chatId: string): Promise<TelegramActionResult> {
  const session = await getTelegramManualSession(chatId);
  if (!session || session.step !== "confirm") {
    await sendTelegramMessage(chatId, "No manual booking is ready to confirm. Send /newbooking to start again.");
    return { ok: false, message: "No booking ready to confirm." };
  }

  const data = session.data;
  if (!data.name || !data.phone || !data.date || !data.time || !data.service || !data.vehicleType || !data.address) {
    throw new Error("Manual booking is missing required details. Send /newbooking to start again.");
  }

  if (!isTimeSlot(data.time)) {
    throw new Error("Manual booking time is not valid.");
  }

  const pricedServices = await getPricedServices();
  const detail = { service: data.service, vehicleType: data.vehicleType, notes: data.notes || "" };
  const estimate = buildBookingEstimate([detail], pricedServices);
  const booking: BookingInput = {
    service: data.service,
    date: data.date,
    time: data.time,
    name: data.name,
    phone: data.phone,
    email: "",
    vehicleType: data.vehicleType,
    carModel: "",
    address: data.address,
    notes: data.notes || "",
    estimatedPrice: data.price || estimate.estimatedPrice,
    details: estimate.details,
    durationHours: 2,
    source: "telegram_manual",
  };

  const savedBooking = await saveBooking(booking);
  await clearTelegramManualSession(chatId);
  await sendTelegramMessage(chatId, [
    "\u2705 <b>Booking saved</b>",
    "",
    await buildTelegramBookingMessage(savedBooking),
  ].join("\n"));
  return { ok: true, message: "Manual booking saved." };
}

async function startPriceManagement(chatId: string) {
  await clearTelegramManualSession(chatId);
  const services = await getPricedServices();
  await saveTelegramPriceSession({
    chatId,
    step: "service",
    updatedAt: new Date().toISOString(),
  });
  await sendTelegramMessage(chatId, buildCurrentPricesMessage(services), {
    inline_keyboard: buildPricePickerKeyboard(services),
  });
}

async function promptForServicePrice(chatId: string, service: PricedService) {
  await saveTelegramPriceSession({
    chatId,
    step: "price",
    service: service.title,
    updatedAt: new Date().toISOString(),
  });

  const prompt = "prices" in service
    ? [
        `Selected: ${escapeTelegramHtml(service.title)}`,
        `Current: ${escapeTelegramHtml(getTelegramPriceLabel(service))}`,
        "",
        "Send one price to update the Sedan/starting price, or send all three like:",
        "Sedan 180 / SUV 200 / Truck 220",
      ].join("\n")
    : [
        `Selected: ${escapeTelegramHtml(service.title)}`,
        `Current: ${escapeTelegramHtml(getTelegramPriceLabel(service))}`,
        "",
        "Send the new price, for example:",
        "$120",
      ].join("\n");

  await sendTelegramMessage(chatId, prompt);
}

async function promptForNonFixedService(chatId: string, service: PricedService) {
  await saveTelegramPriceSession({
    chatId,
    step: "overrideChoice",
    service: service.title,
    updatedAt: new Date().toISOString(),
  });

  await sendTelegramMessage(
    chatId,
    [
      `Selected: ${escapeTelegramHtml(service.title)}`,
      `Current: ${escapeTelegramHtml(getTelegramPriceLabel(service))}`,
      "",
      "This service is non-fixed.",
      "Choose Set Override only if you want a temporary dollar price.",
    ].join("\n"),
    {
      inline_keyboard: [[
        { text: "Set Override", callback_data: `prices_override:${service.code}` },
        { text: "Use Non-Fixed", callback_data: `prices_clear:${service.code}` },
      ]],
    }
  );
}

async function processPriceInput(session: TelegramPriceSession, text: string) {
  if (session.step !== "price" || !session.service) {
    throw new Error("Choose a service first.");
  }

  const services = await getPricedServices();
  const service = services.find((item) => item.title === session.service);

  if (!service) {
    throw new Error("That service was not found.");
  }

  const pendingUpdate = parsePriceUpdate(text, service);
  console.info("Service price update requested", {
    chatId: session.chatId,
    service: service.title,
    update: pendingUpdate,
  });

  await saveTelegramPriceSession({
    chatId: session.chatId,
    step: "confirm",
    service: service.title,
    pendingUpdate,
    updatedAt: new Date().toISOString(),
  });

  await sendTelegramMessage(session.chatId, buildPriceConfirmationMessage(service, pendingUpdate), {
    inline_keyboard: [[
      { text: "Confirm", callback_data: "prices_confirm" },
      { text: "Cancel", callback_data: "prices_cancel" },
    ]],
  });
}

async function confirmPriceUpdate(chatId: string): Promise<TelegramActionResult> {
  const session = await getTelegramPriceSession(chatId);

  if (!session || session.step !== "confirm" || !session.service || !session.pendingUpdate) {
    await sendTelegramMessage(chatId, "No price update is ready to confirm.");
    return { ok: false, message: "No price update ready." };
  }

  await updateServicePricing(session.service, session.pendingUpdate);
  await clearTelegramPriceSession(chatId);
  revalidatePath("/");
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/settings");
  console.info("Service price updated", {
    chatId,
    service: session.service,
    update: session.pendingUpdate,
  });
  await sendTelegramMessage(chatId, "Price updated successfully.");
  return { ok: true, message: "Service price updated." };
}

async function sendTodaySchedule(chatId: string, date = getTodayLosAngelesDate()) {
  const [bookings, blocks] = await Promise.all([listBookingsByDate(date), listScheduleBlocks(date)]);
  await sendTelegramMessage(chatId, buildTodayScheduleMessage(bookings, blocks));
  console.info("Today schedule sent", { chatId, date, bookingCount: bookings.length, blockCount: blocks.length });
}

async function saveAndPrompt(session: TelegramManualSession, prompt: string) {
  await saveTelegramManualSession(session);
  await sendTelegramMessage(session.chatId, prompt);
}

async function buildTelegramBookingMessage(booking: TelegramBooking) {
  const services = await getPricedServices();
  const details = booking.details?.length
    ? booking.details
    : [{ service: booking.service, vehicleType: booking.vehicleType, notes: booking.notes }];
  const estimate = buildBookingEstimate(details, services);
  const notes = estimate.details.map((detail) => detail.notes).filter(Boolean).join(" | ") || booking.notes || "N/A";

  return [
    "<b>New DETAILX Booking</b>",
    "",
    `<b>Booking ID:</b> ${escapeTelegramHtml(booking.id)}`,
    `<b>Name:</b> ${escapeTelegramHtml(booking.name)}`,
    `<b>Phone:</b> ${escapeTelegramHtml(booking.phone)}`,
    `<b>Email:</b> ${escapeTelegramHtml(booking.email || "N/A")}`,
    ...(booking.carModel ? [`<b>Car:</b> ${escapeTelegramHtml(booking.carModel)}`] : []),
    `<b>Date:</b> ${escapeTelegramHtml(booking.date)}`,
    `<b>Time:</b> ${escapeTelegramHtml(booking.time)}`,
    `<b>Location:</b> ${escapeTelegramHtml(booking.address)}`,
    "",
    ...estimate.details.flatMap((detail) => [
      `<b>Detail ${detail.lineNumber}</b>`,
      `Service: ${escapeTelegramHtml(detail.service)}`,
      `${escapeTelegramHtml(getDisplayAssetLabel(detail.service))}: ${escapeTelegramHtml(detail.vehicleType)}`,
      `Price: ${escapeTelegramHtml(detail.estimatedPrice)}`,
      "",
    ]),
    ...(hasFreeWaxBonus(estimate.details) ? [`<b>Bonus:</b> ${escapeTelegramHtml(freeWaxBonusLabel)}`, ""] : []),
    `<b>Total:</b> ${escapeTelegramHtml(booking.estimatedPrice || estimate.estimatedPrice)}`,
    `<b>Notes:</b> ${escapeTelegramHtml(notes)}`,
    `<b>Status:</b> ${formatStatus(booking.status || "pending")}`,
    `<b>Admin:</b> ${escapeTelegramHtml(buildAdminBookingUrl(booking))}`,
  ].join("\n");
}

function buildTodayScheduleMessage(bookings: StoredBooking[], blocks: Awaited<ReturnType<typeof listScheduleBlocks>>) {
  const activeBookings = bookings.filter((booking) => booking.status !== "cancelled").sort((a, b) => sortByTime(a.time, b.time));
  const sortedBlocks = [...blocks].sort((a, b) => sortByTime(a.startTime || a.time, b.startTime || b.time));

  if (!activeBookings.length && !sortedBlocks.length) {
    return "No jobs scheduled for today.";
  }

  return [
    "Today's DETAILX schedule:",
    "",
    ...activeBookings.flatMap((booking) => [
      `${escapeTelegramHtml(booking.time)} - ${escapeTelegramHtml(booking.name)}`,
      `Phone: ${escapeTelegramHtml(booking.phone)}`,
      ...(booking.carModel ? [`${escapeTelegramHtml(isBoatDetailingService(booking.service) ? "Boat size" : "Car")}: ${escapeTelegramHtml(booking.carModel)}`] : []),
      `Address: ${escapeTelegramHtml(booking.address)}`,
      `Price: ${escapeTelegramHtml(booking.estimatedPrice || "Estimate pending")}`,
      ...(hasFreeWaxBonus(booking.details?.length ? booking.details : [{ service: booking.service }]) ? [`Bonus: ${escapeTelegramHtml(freeWaxBonusLabel)}`] : []),
      "",
    ]),
    ...(sortedBlocks.length
      ? [
          "Blocked:",
          ...sortedBlocks.map((block) => `${escapeTelegramHtml(block.startTime || block.time)}-${escapeTelegramHtml(block.endTime)} - ${escapeTelegramHtml(block.reason || "Busy")}`),
        ]
      : []),
  ].join("\n").trim();
}

async function buildManualBookingConfirmation(session: TelegramManualSession) {
  const data = session.data;
  const services = await getPricedServices();
  const estimate = data.service && data.vehicleType
    ? buildBookingEstimate([{ service: data.service, vehicleType: data.vehicleType, notes: data.notes || "" }], services).estimatedPrice
    : "Estimate pending";

  return [
    "<b>Confirm booking?</b>",
    "",
    `Name: ${escapeTelegramHtml(data.name || "")}`,
    `Phone: ${escapeTelegramHtml(data.phone || "")}`,
    `Date: ${escapeTelegramHtml(data.date || "")}`,
    `Time: ${escapeTelegramHtml(data.time || "")}`,
    `Service: ${escapeTelegramHtml(data.service || "")}`,
    `${escapeTelegramHtml(isBoatDetailingService(data.service || "") ? "Asset" : "Vehicle")}: ${escapeTelegramHtml(data.vehicleType || "")}`,
    `Address: ${escapeTelegramHtml(data.address || "")}`,
    `Price: ${escapeTelegramHtml(data.price || estimate)}`,
    `Notes: ${escapeTelegramHtml(data.notes || "N/A")}`,
  ].join("\n");
}

function buildServicePrompt(services: readonly PricedService[]) {
  return [
    "Service/detail name?",
    "",
    ...services.map((service, index) => `${index + 1}. ${service.title} - ${getTelegramPriceLabel(service)}`),
  ].join("\n");
}

function buildCurrentPricesMessage(services: readonly PricedService[]) {
  return [
    "Current prices:",
    ...services.map((service, index) => `${index + 1}. ${service.title} - ${getTelegramPriceLabel(service)}`),
    "",
    "Which service do you want to update?",
  ].join("\n");
}

function buildPricePickerKeyboard(services: readonly PricedService[]) {
  return services.map((service) => [{ text: service.title, callback_data: `prices_pick:${service.code}` }]);
}

function buildPriceConfirmationMessage(service: PricedService, update: TelegramPriceUpdate) {
  const nextService = "prices" in service
    ? {
        ...service,
        prices: {
          ...service.prices,
          ...(update.prices || {}),
        },
      }
    : {
        ...service,
        startingPrice: update.startingPrice ?? service.startingPrice,
      };

  const currentLabel = "prices" in service && update.prices && Object.keys(update.prices).length > 1
    ? getTelegramPriceLabel(service)
    : getPrimaryPriceLabel(service);
  const nextLabel = "prices" in nextService && update.prices && Object.keys(update.prices).length > 1
    ? getTelegramPriceLabel(nextService)
    : getPrimaryPriceLabel(nextService);

  return [
    `Update ${escapeTelegramHtml(service.title)} from ${escapeTelegramHtml(currentLabel)} to ${escapeTelegramHtml(nextLabel)}?`,
  ].join("\n");
}

function getPrimaryPriceLabel(service: PricedService) {
  if ("prices" in service) {
    return `$${service.prices.Sedan}`;
  }

  if (isNonFixedService(service)) {
    return "To be discussed";
  }

  return `$${service.startingPrice}`;
}

function parsePriceUpdate(text: string, service: PricedService): TelegramPriceUpdate {
  if ("prices" in service) {
    const vehicleMatches = Array.from(text.matchAll(/(sedan|suv|truck)\s*\$?\s*(\d+)/gi));

    if (vehicleMatches.length) {
      const prices = vehicleMatches.reduce<Partial<Record<VehicleType, number>>>((acc, match) => {
        const vehicle = capitalize(match[1].toLowerCase()) as VehicleType;
        acc[vehicle] = Number(match[2]);
        return acc;
      }, {});

      if (!prices.Sedan || !prices.SUV || !prices.Truck) {
        throw new Error("Send all three vehicle prices: Sedan, SUV, and Truck.");
      }

      return { service: service.title, prices };
    }

    const amount = extractFirstPrice(text);
    if (!amount) {
      throw new Error("Send a valid price like $180 or Sedan 180 / SUV 200 / Truck 220.");
    }

    return {
      service: service.title,
      prices: { Sedan: amount },
    };
  }

  const amount = extractFirstPrice(text);
  if (!amount) {
    throw new Error("Send a valid price like $120.");
  }

  return {
    service: service.title,
    startingPrice: amount,
  };
}

function isNonFixedService(service: PricedService) {
  return !("prices" in service) && Boolean(service.nonFixedPrice);
}

function buildAdminBookingUrl(booking: TelegramBooking) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://detailxla.com").replace(/\/$/, "");
  const search = booking.email || booking.phone || booking.id;
  return `${siteUrl}/admin/bookings?search=${encodeURIComponent(search)}`;
}

async function answerTelegramCallback(callbackQueryId: string, text: string) {
  try {
    await telegramApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
      show_alert: false,
    });
  } catch (error) {
    console.error("Telegram answerCallbackQuery failed", error);
  }
}

async function sendTelegramMessage(chatId: string, text: string, replyMarkup?: Record<string, unknown>) {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function telegramApi(method: string, payload: Record<string, unknown>) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Telegram ${method} failed with ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

function normalizeTelegramTime(value: string): TimeSlot | null {
  const compact = value.trim().toLowerCase().replace(/\s+/g, "");
  const direct = timeSlots.find((slot) => slot.toLowerCase().replace(/\s+/g, "") === compact);
  if (direct) {
    return direct;
  }

  const hourMatch = compact.match(/^(\d{1,2})(?::00)?(am|pm)?$/);
  if (!hourMatch) {
    return null;
  }

  const hour = Number(hourMatch[1]);
  const period = hourMatch[2] || (hour >= 6 && hour <= 11 ? "am" : "pm");
  const candidate = `${hour}:00 ${period.toUpperCase()}`;
  return isTimeSlot(candidate) ? candidate : null;
}

function normalizeTelegramService(value: string, services: readonly PricedService[]): BookingService | null {
  const index = Number(value.trim());
  if (Number.isInteger(index) && index > 0 && index <= services.length) {
    return services[index - 1].title;
  }

  const normalized = value.trim().toLowerCase();
  const service = bookingServices.find((item) => item.toLowerCase() === normalized) || services.find((item) => item.title.toLowerCase().includes(normalized))?.title;
  return service || null;
}

function normalizeTelegramVehicle(value: string): VehicleType | null {
  const normalized = value.trim().toLowerCase();
  return vehicleTypes.find((vehicle) => vehicle.toLowerCase() === normalized) || null;
}

function requireMinText(value: string, label: string, minLength: number) {
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new Error(`${label} is too short.`);
  }

  return trimmed;
}

function normalizePrice(value: string) {
  const cleaned = value.trim();
  if (!cleaned) {
    return "";
  }

  return cleaned.startsWith("$") ? cleaned : `$${cleaned}`;
}

function isSkip(value: string) {
  return ["skip", "none", "n/a", "na", "-"].includes(value.trim().toLowerCase());
}

function getChatId(value: number | string | undefined) {
  return value === undefined ? "" : String(value);
}

function getTodayLosAngelesDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function formatStatus(status: BookingStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function sortByTime(first: string, second: string) {
  return (parseTimeSlotToMinutes(first) ?? 0) - (parseTimeSlotToMinutes(second) ?? 0);
}

function escapeTelegramHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function extractFirstPrice(value: string) {
  const match = value.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isAdminChat(chatId: string) {
  return Boolean(chatId) && chatId === String(process.env.TELEGRAM_CHAT_ID || "");
}

async function getServiceFromCallbackCode(code: string) {
  const services = await getPricedServices();
  return services.find((service) => service.code === code) || null;
}
