"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { Attribution, BusinessSettings } from "@/lib/platform/types";
type Ads = {
  google_ads_id: string;
  google_ads_label: string;
  meta_pixel_id: string;
};
type TrackingWindow = Window & {
  wlGtag?: (...args: unknown[]) => void;
  wlPixel?: (...args: unknown[]) => void;
  wlAds?: Ads;
};
let memorySession: { session_id: string; attribution: Attribution } | null =
  null;
export function visitor() {
  if (memorySession) return memorySession;
  try {
    const saved = sessionStorage.getItem("wl_visitor");
    if (saved) {
      memorySession = JSON.parse(saved);
      return memorySession!;
    }
  } catch {}
  const p = new URLSearchParams(location.search);
  let referrer = "";
  try {
    referrer = new URL(document.referrer).origin;
  } catch {}
  memorySession = {
    session_id: crypto.randomUUID(),
    attribution: {
      source: p.get("utm_source") || "",
      medium: p.get("utm_medium") || "",
      campaign: p.get("utm_campaign") || "",
      term: p.get("utm_term") || "",
      content: p.get("utm_content") || "",
      gclid: p.get("gclid") || "",
      fbclid: p.get("fbclid") || "",
      landing_page: location.origin + location.pathname,
      referrer,
    },
  };
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
  const map: Record<string, string> = {
    page_view: "PageView",
    service_view: "ViewContent",
    booking_started: "InitiateCheckout",
    phone_clicked: "Contact",
  };
  if (map[name]) w.wlPixel?.("track", map[name], {});
}
const sent = new Set<string>();
export function confirmedConversion(
  id: string,
  value: number | null,
  eventId: string,
  paid = false,
) {
  if (
    !id ||
    !eventId ||
    (value !== null && (!Number.isFinite(value) || value < 0))
  )
    return;
  const key = (paid ? "payment:" : "booking:") + id;
  try {
    if (sent.has(key) || sessionStorage.getItem("wl_conversion:" + key)) return;
  } catch {}
  const w = window as TrackingWindow,
    config = w.wlAds;
  if (paid)
    w.wlGtag?.("event", "purchase", {
      transaction_id: id,
      value: (value || 0) / 100,
      currency: "USD",
    });
  else if (config?.google_ads_id && config.google_ads_label)
    w.wlGtag?.("event", "conversion", {
      send_to: config.google_ads_id + "/" + config.google_ads_label,
      transaction_id: id,
      ...(value == null ? {} : { value: value / 100, currency: "USD" }),
    });
  w.wlPixel?.(
    "track",
    paid ? "Purchase" : "Lead",
    value == null ? {} : { value: value / 100, currency: "USD" },
    { eventID: eventId },
  );
  sent.add(key);
  try {
    sessionStorage.setItem("wl_conversion:" + key, "1");
  } catch {}
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
    | "meta_pixel_id"
  >;
}) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname.startsWith("/admin")) return;
    const w = window as TrackingWindow;
    w.wlAds = config;
    const ids = [
      config.google_tag_id,
      config.ga4_id,
      config.google_ads_id,
    ].filter(Boolean);
    if (ids.length && !w.wlGtag) {
      const layer: unknown[][] = [];
      (window as unknown as { dataLayer: unknown[][] }).dataLayer = layer;
      w.wlGtag = (...args) => layer.push(args);
      w.wlGtag("js", new Date());
      ids.forEach((id) => w.wlGtag?.("config", id, { send_page_view: false }));
      const script = document.createElement("script");
      script.async = true;
      script.src =
        "https://www.googletagmanager.com/gtag/js?id=" +
        encodeURIComponent(ids[0]);
      document.head.appendChild(script);
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
    track("page_view", { path: pathname });
  }, [pathname, config]);
  return null;
}
