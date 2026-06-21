export const GOOGLE_ADS_ID = "AW-18082565611";
export const BOOKING_CONVERSION_SEND_TO = "AW-18082565611/USX2CObpmZ4cEOubuK5D";

type GtagCommand = "js" | "config" | "event";
type GtagFunction = (command: GtagCommand, target: string | Date, params?: Record<string, unknown>) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GtagFunction;
  }
}

const firedBookingConversions = new Set<string>();

export function fireBookingConversion(transactionId = "") {
  if (typeof window === "undefined") {
    return false;
  }

  const conversionKey = transactionId || "detailx-booking-conversion";
  if (firedBookingConversions.has(conversionKey)) {
    return false;
  }

  try {
    const gtag =
      window.gtag ||
      ((...args: Parameters<GtagFunction>) => {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push(args);
      });

    gtag("event", "conversion", {
      send_to: BOOKING_CONVERSION_SEND_TO,
      transaction_id: transactionId,
    });
    firedBookingConversions.add(conversionKey);
    return true;
  } catch (error) {
    console.warn("Google Ads booking conversion could not be fired.", error);
    return false;
  }
}
