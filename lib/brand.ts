export const BRAND_NAME = "West Loop Ceramics";
export const BRAND_DESCRIPTION =
  "Car detailing, paint correction, and ceramic coating in Chicago’s West Loop. Compare services, review current prices, and book your visit online.";

/** Resolve the former default at read time without changing saved business details. */
export function resolveBusinessName(name?: string): string {
  const normalized = name?.trim();
  return !normalized || normalized.toLowerCase() === "west loop auto spa"
    ? BRAND_NAME
    : normalized;
}
