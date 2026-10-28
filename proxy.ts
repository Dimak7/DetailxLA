import { NextRequest, NextResponse } from "next/server";
import { canonicalRedirectUrl } from "@/lib/canonical-redirect";

export function proxy(request: NextRequest) {
  // Next can normalize request.url to the application host behind a proxy.
  // Only the exact aliases in canonicalRedirectUrl are eligible for a redirect.
  const url = request.nextUrl.clone();
  url.host = request.headers.get("host") || url.host;
  const destination = canonicalRedirectUrl(url.href, request.method, process.env.ADMIN_PREVIEW === "true");
  return destination ? NextResponse.redirect(destination, 308) : NextResponse.next();
}

export const config = {
  matcher: ["/", "/services/:path*", "/contact", "/gallery", "/booking", "/privacy-notice", "/service-rules", "/sitemap.xml"],
};
