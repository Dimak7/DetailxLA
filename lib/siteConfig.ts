export const serviceAreas = [
  "Los Angeles",
  "Beverly Hills",
  "Santa Monica",
  "West Hollywood",
  "Glendale",
  "Pasadena",
  "Culver City",
  "Long Beach",
  "Burbank",
  "Sherman Oaks",
  "Malibu",
] as const;

export const siteConfig = {
  brandName: "DETAILX LA",
  city: "Los Angeles",
  state: "California",
  primaryTagline: "Premium Mobile Detailing in Los Angeles",
  shortDescription:
    "We come to you anywhere in LA for premium mobile detailing, paint correction, ceramic coating, and maintenance care.",
  bookingDescription:
    "Mobile car detailing for daily drivers, luxury cars, SUVs, trucks, and exotics.",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://detailxla.com",
  businessEmail: process.env.BUSINESS_EMAIL || "sales@detailxla.com",
  timezone: "America/Los_Angeles",
  optionalPhone: process.env.NEXT_PUBLIC_BUSINESS_PHONE || "",
  optionalInstagramUrl: process.env.NEXT_PUBLIC_INSTAGRAM_URL || "",
  optionalInstagramHandle: process.env.NEXT_PUBLIC_INSTAGRAM_HANDLE || "@detailxla",
  optionalGoogleBusinessUrl: process.env.NEXT_PUBLIC_GOOGLE_BUSINESS_URL || "",
} as const;

export function getAbsoluteSiteUrl() {
  return siteConfig.siteUrl.replace(/\/$/, "");
}
