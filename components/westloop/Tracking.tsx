"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { Attribution, BusinessSettings } from "@/lib/platform/types";

type Ads = {
  google_ads_id: string;
  google_ads_label: string;
  google_ads_phone_label: string;
  meta_pixel_id: string;
};
type PendingConversion = {
  id: string;
  value: number | null;
  eventId: string;
  paid: boolean;
};
type TrackingWindow = Window & {
  wlGtag?: (...args: unknown[]) => void;
  wlPixel?: (...args: unknown[]) => void;
  wlAds?: Ads;
  wlConfiguredGoogleIds?: Set<string>;
  wlPendingConversions?: PendingConversion[];
};

const emptyAttribution: Attribution = {
  source: "",
  lead_stream: "",
  medium: "",
  campaign: "",
  term: "",
  content: "",
  gclid: "",
  gbraid: "",
  wbraid: "",
  fbclid: "",
  landing_page: "",
  referrer: "",
};
const attributionLifetime = 90 * 24 * 60 * 60 * 1000;
let memorySession: { session_id: string; attribution: Attribution } | null =
  null;

function completeAttribution(value: Partial<Attribution> = {}) {
  return { ...emptyAttribution, ...value };
}

export function visitor() {
  if (memorySession) return memorySession;
  try {
    const saved = sessionStorage.getItem("wl_visitor");
    if (saved) {
      const parsed = JSON.parse(saved) as {
        session_id: string;
        attribution: Partial<Attribution>;
      };
      memorySession = {
        session_id: parsed.session_id,
        attribution: completeAttribution(parsed.attribution),
      };
      return memorySession;
    }
  } catch {}
  const p = new URLSearchParams(location.search);
  let referrer = "";
  try {
    referrer = new URL(document.referrer).origin;
  } catch {}
  let attribution = completeAttribution({
    source: p.get("utm_source") || "",
    lead_stream: p.get("lead_stream") || p.get("utm_account") || "",
    medium: p.get("utm_medium") || "",
    campaign: p.get("utm_campaign") || "",
    term: p.get("utm_term") || "",
    content: p.get("utm_content") || "",
    gclid: p.get("gclid") || "",
    gbraid: p.get("gbraid") || "",
    wbraid: p.get("wbraid") || "",
    fbclid: p.get("fbclid") || "",
    landing_page: location.origin + location.pathname,
    referrer,
  });
  const hasCampaign = Boolean(
      attribution.source ||
      attribution.lead_stream ||
      attribution.medium ||
      attribution.campaign ||
      attribution.gclid ||
      attribution.gbraid ||
      attribution.wbraid ||
      attribution.fbclid,
  );
  try {
    if (hasCampaign)
      localStorage.setItem(
        "wl_attribution",
        JSON.stringify({ attribution, captured_at: Date.now() }),
      );
    else {
      const stored = JSON.parse(
        localStorage.getItem("wl_attribution") || "null",
      ) as { attribution?: Partial<Attribution>; captured_at?: number } | null;
      if (
        stored?.attribution &&
        stored.captured_at &&
        Date.now() - stored.captured_at < attributionLifetime
      )
        attribution = completeAttribution(stored.attribution);
    }
  } catch {}
  memorySession = { session_id: crypto.randomUUID(), attribution };
  try {
    sessionStorage.setItem("wl_visitor", JSON.stringify(memorySession));
  } catch {}
  return memorySession;
}

export function track(name: string, metadata: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const info = visitor();
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      name,
      ...info,
      device:
        innerWidth < 768 ? "mobile" : innerWidth < 1100 ? "tablet" : "desktop",
      metadata,
    }),
  }).catch(() => {});
  const w = window as TrackingWindow;
  w.wlGtag?.("event", name, metadata);
  if (
    name === "phone_clicked" &&
    w.wlAds?.google_ads_id &&
    w.wlAds.google_ads_phone_label
  )
    w.wlGtag?.("event", "conversion", {
      send_to:
        w.wlAds.google_ads_id + "/" + w.wlAds.google_ads_phone_label,
    });
  const map: Record<string, string> = {
    page_view: "PageView",
    service_view: "ViewContent",
    booking_started: "InitiateCheckout",
    phone_clicked: "Contact",
  };
  if (map[name]) w.wlPixel?.("track", map[name], {});
}

const sent = new Set<string>();
const conversionKey = (conversion: PendingConversion) =>
  (conversion.paid ? "payment:" : "booking:") + conversion.id;
function wasSent(key: string) {
  try {
    return sent.has(key) || sessionStorage.getItem("wl_conversion:" + key) === "1";
  } catch {
    return sent.has(key);
  }
}
function markSent(key: string) {
  sent.add(key);
  try {
    sessionStorage.setItem("wl_conversion:" + key, "1");
  } catch {}
}
function emitConversion(conversion: PendingConversion) {
  const w = window as TrackingWindow,
    config = w.wlAds;
  let delivered = false;
  if (conversion.paid && w.wlGtag) {
    w.wlGtag("event", "purchase", {
      transaction_id: conversion.id,
      value: (conversion.value || 0) / 100,
      currency: "USD",
    });
    delivered = true;
  } else if (
    w.wlGtag &&
    config?.google_ads_id &&
    config.google_ads_label
  ) {
    const value =
      conversion.value == null
        ? {}
        : { value: conversion.value / 100, currency: "USD" };
    w.wlGtag("event", "generate_lead", {
      transaction_id: conversion.id,
      ...value,
    });
    w.wlGtag("event", "conversion", {
      send_to: config.google_ads_id + "/" + config.google_ads_label,
      transaction_id: conversion.id,
      ...value,
    });
    delivered = true;
  }
  if (w.wlPixel) {
    w.wlPixel(
      "track",
      conversion.paid ? "Purchase" : "Lead",
      conversion.value == null
        ? {}
        : { value: conversion.value / 100, currency: "USD" },
      { eventID: conversion.eventId },
    );
    delivered = true;
  }
  return delivered;
}
function flushConversions() {
  const w = window as TrackingWindow,
    pending = w.wlPendingConversions || [];
  w.wlPendingConversions = pending.filter((conversion) => {
    const key = conversionKey(conversion);
    if (wasSent(key)) return false;
    if (!emitConversion(conversion)) return true;
    markSent(key);
    return false;
  });
}
export function confirmedConversion(
  id: string,
  value: number | null,
  eventId: string,
  paid = false,
) {
  if (
    typeof window === "undefined" ||
    !id ||
    !eventId ||
    (value !== null && (!Number.isFinite(value) || value < 0))
  )
    return;
  const conversion = { id, value, eventId, paid },
    key = conversionKey(conversion),
    w = window as TrackingWindow;
  if (wasSent(key)) return;
  if (emitConversion(conversion)) {
    markSent(key);
    return;
  }
  const pending = (w.wlPendingConversions ||= []);
  if (!pending.some((item) => conversionKey(item) === key))
    pending.push(conversion);
}

export function Tracking({
  config,
}: {
  config: Pick<
    BusinessSettings,
    | "google_tag_id"
    | "ga4_id"
    | "google_ads_id"
    | "google_ads_label"
    | "google_ads_phone_label"
    | "meta_pixel_id"
  >;
}) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname.startsWith("/admin")) return;
    const w = window as TrackingWindow;
    w.wlAds = config;
    const ids = [
      ...new Set(
        [config.google_tag_id, config.ga4_id, config.google_ads_id].filter(
          Boolean,
        ),
      ),
    ];
    if (ids.length) {
      if (!w.wlGtag) {
        const host = window as unknown as { dataLayer?: unknown[][] };
        const layer = (host.dataLayer ||= []);
        w.wlGtag = (...args) => layer.push(args);
        w.wlGtag("js", new Date());
      }
      const configured = (w.wlConfiguredGoogleIds ||= new Set());
      ids.forEach((id) => {
        if (configured.has(id)) return;
        w.wlGtag?.("config", id, { send_page_view: false });
        configured.add(id);
      });
      if (!document.querySelector("script[data-wl-google-tag]")) {
        const script = document.createElement("script");
        script.async = true;
        script.dataset.wlGoogleTag = "true";
        script.src =
          "https://www.googletagmanager.com/gtag/js?id=" +
          encodeURIComponent(ids[0]);
        document.head.appendChild(script);
      }
    }
    if (config.meta_pixel_id && !w.wlPixel) {
      type FB = ((...args: unknown[]) => void) & {
        queue: unknown[][];
        loaded: boolean;
        version: string;
        push?: FB;
        callMethod?: (...args: unknown[]) => void;
      };
      const fb: FB = Object.assign(
        (...args: unknown[]) => {
          if (fb.callMethod) fb.callMethod(...args);
          else fb.queue.push(args);
        },
        { queue: [] as unknown[][], loaded: true, version: "2.0" },
      );
      fb.push = fb;
      (window as unknown as { fbq: FB; _fbq: FB }).fbq = fb;
      (window as unknown as { _fbq: FB })._fbq = fb;
      w.wlPixel = fb;
      fb("init", config.meta_pixel_id);
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      document.head.appendChild(script);
    }
    flushConversions();
    track("page_view", { path: pathname });
  }, [pathname, config]);
  return null;
}
