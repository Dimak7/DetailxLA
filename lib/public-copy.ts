// Existing catalogues retain the original wording; change only its display.
export function publicServiceInclusion(item: string): string {
  return item === "Dashboard, doors and vents" ? "Dashboard, doors, and vents" : item;
}
