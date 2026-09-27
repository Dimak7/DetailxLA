export const BRAND_NAME = "West Loop Ceramics";
export const BRAND_DESCRIPTION =
  "Ceramic coatings, paint correction and considered detailing in Chicago's West Loop. A deeper gloss. A finish made for the everyday.";

/** Resolve the former default at read time without changing saved business details. */
export function resolveBusinessName(name?: string): string {
  const normalized = name?.trim();
  return !normalized || normalized.toLowerCase() === "west loop auto spa"
    ? BRAND_NAME
    : normalized;
}
