export const META_PIXEL_ID = "1068406188841432";

type MetaPixelEvent = "PageView" | "Lead" | "Purchase" | "CompleteRegistration" | string;
type MetaPixelFunction = (command: "track" | "init", event: MetaPixelEvent, data?: Record<string, unknown>) => void;

declare global {
  interface Window {
    fbq?: MetaPixelFunction;
  }
}

const firedMetaEvents = new Set<string>();

export function trackFBEvent(event: MetaPixelEvent, data: Record<string, unknown> = {}, dedupeKey?: string) {
  if (typeof window === "undefined" || typeof window.fbq !== "function") {
    return false;
  }

  const eventKey = dedupeKey ? `${event}:${dedupeKey}` : "";
  if (eventKey && firedMetaEvents.has(eventKey)) {
    return false;
  }

  try {
    window.fbq("track", event, data);
    if (eventKey) {
      firedMetaEvents.add(eventKey);
    }
    return true;
  } catch (error) {
    console.warn("Meta Pixel event could not be fired.", error);
    return false;
  }
}

export function trackBookingLead(bookingId = "") {
  return trackFBEvent("Lead", {}, bookingId || "detailx-booking-lead");
}
