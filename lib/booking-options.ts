import { priceFor, type Service } from "./platform/types";

export type BookingAddOn = {
  id: string;
  name: string;
  priceCents: number;
  description: string;
};

export type ServicePackage = {
  id: string;
  name: string;
  priceCents: number | null;
  description: string;
};

const addOns: Record<string, BookingAddOn> = {
  "engine-bay": { id: "engine-bay", name: "Engine Bay", priceCents: 6500, description: "A careful clean and finish for accessible engine-bay surfaces." },
  "ceramic-sealant": { id: "ceramic-sealant", name: "Ceramic Sealant", priceCents: 3500, description: "Adds protection, gloss and water repellency to the exterior finish." },
  "tar-removal": { id: "tar-removal", name: "Tar Removal", priceCents: 4500, description: "Targets bonded road tar that a routine hand wash cannot safely lift." },
  "trim-restoration": { id: "trim-restoration", name: "Trim Restoration", priceCents: 4500, description: "Revives faded exterior trim for a darker, more even appearance." },
  "overspray-removal": { id: "overspray-removal", name: "Overspray Removal", priceCents: 17500, description: "Condition-based removal of suitable bonded paint mist and contamination." },
  decontamination: { id: "decontamination", name: "Decontamination", priceCents: 5500, description: "Removes bonded surface contamination to leave the paint noticeably smoother." },
  "interior-trim-polish": { id: "interior-trim-polish", name: "Interior Trim Polish", priceCents: 8000, description: "Refines suitable gloss trim to reduce light haze and improve clarity." },
  "headlight-restoration": { id: "headlight-restoration", name: "Headlight Restoration", priceCents: 7500, description: "Improves clarity on suitable oxidized headlight lenses and adds protection." },
  "scratch-removal": { id: "scratch-removal", name: "Scratch Removal", priceCents: 15000, description: "Focused assessment and correction of suitable isolated paint scratches." },
  "window-polish": { id: "window-polish", name: "Window Polish", priceCents: 22500, description: "Deep glass refinement for suitable mineral deposits and bonded contamination." },
  "chrome-polish": { id: "chrome-polish", name: "Chrome Polish", priceCents: 12500, description: "Restores clarity and shine to suitable exterior chrome surfaces." },
  "exhaust-tip-polish": { id: "exhaust-tip-polish", name: "Exhaust Tip Polish", priceCents: 2500, description: "Cleans and refines accessible exhaust tips for a crisp finishing detail." },
  "hair-removal": { id: "hair-removal", name: "Hair Removal", priceCents: 7500, description: "Additional time and tools for embedded pet hair throughout the cabin." },
  "heavy-soil": { id: "heavy-soil", name: "Heavy Soil / Stains", priceCents: 7500, description: "Extra treatment for heavily soiled areas and suitable stubborn stains." },
  "bio-clean": { id: "bio-clean", name: "Bio Clean", priceCents: 15000, description: "A deeper condition-based interior cleaning for biological contamination." },
  ozone: { id: "ozone", name: "Ozone", priceCents: 7500, description: "An odor-treatment cycle after the source has been cleaned and removed." },
  "car-seat": { id: "car-seat", name: "Car Seat", priceCents: 1000, description: "Surface cleaning for one removable child car seat, when appropriate." },
};

const serviceAddOns: Record<string, string[]> = {
  "interior-detail": ["hair-removal", "heavy-soil", "bio-clean", "ozone", "car-seat", "interior-trim-polish"],
  "deep-interior-cleaning": ["bio-clean", "ozone", "car-seat", "interior-trim-polish"],
  "exterior-detail": ["ceramic-sealant", "decontamination", "tar-removal", "trim-restoration", "engine-bay", "headlight-restoration", "scratch-removal", "exhaust-tip-polish"],
  "full-detail": ["ceramic-sealant", "decontamination", "engine-bay", "hair-removal", "heavy-soil", "ozone"],
  "ceramic-coating": ["decontamination", "trim-restoration", "window-polish", "chrome-polish", "exhaust-tip-polish"],
  "paint-correction": ["ceramic-sealant", "trim-restoration", "headlight-restoration", "scratch-removal", "window-polish", "chrome-polish", "exhaust-tip-polish"],
  "headlight-restoration": ["ceramic-sealant"],
};

const packages: Record<string, ServicePackage[]> = {
  "ceramic-coating": [
    { id: "ceramic-2-year", name: "2 Year", priceCents: 55000, description: "Our entry protection package, starting at $550 after paint assessment." },
    { id: "ceramic-5-year", name: "5 Year", priceCents: 125000, description: "Longer-term protection, starting at $1,250 after paint assessment." },
    { id: "ceramic-10-year", name: "10 Year", priceCents: 175000, description: "Our longest-term package, starting at $1,750 after paint assessment." },
  ],
  "paint-correction": [
    { id: "correction-level-1", name: "Level 1 · 60% Correction", priceCents: 52500, description: "A focused refinement for lighter swirls, haze and improved gloss." },
    { id: "correction-level-2", name: "Level 2 · 75% Correction", priceCents: 75000, description: "A more involved correction for stronger defect reduction and clarity." },
    { id: "correction-level-3", name: "Level 3 · By Quote", priceCents: null, description: "A custom plan for demanding paintwork after an in-person assessment." },
  ],
};

export function bookingAddOns(slug?: string): BookingAddOn[] {
  return (slug ? serviceAddOns[slug] || [] : []).map((id) => addOns[id]).filter(Boolean);
}

export function servicePackages(slug?: string): ServicePackage[] {
  return slug ? packages[slug] || [] : [];
}

export function defaultServicePackage(slug?: string): string {
  return servicePackages(slug)[0]?.id || "";
}

export function bookingSelection(
  service: Service,
  vehicleType: string,
  packageId = "",
  addOnIds: string[] = [],
) {
  const availablePackages = servicePackages(service.slug);
  const selectedPackage = availablePackages.length
    ? availablePackages.find((item) => item.id === (packageId || availablePackages[0].id))
    : undefined;
  if (availablePackages.length && !selectedPackage) throw new Error("Choose a valid service package.");

  const availableAddOns = bookingAddOns(service.slug);
  const uniqueIds = [...new Set(addOnIds)];
  const selectedAddOns = uniqueIds.map((id) => availableAddOns.find((item) => item.id === id));
  if (selectedAddOns.some((item) => !item)) throw new Error("Choose valid upgrades for this service.");

  const baseCents = selectedPackage ? selectedPackage.priceCents : priceFor(service, vehicleType);
  const addOnCents = selectedAddOns.reduce((sum, item) => sum + (item?.priceCents || 0), 0);
  return {
    selectedPackage,
    selectedAddOns: selectedAddOns as BookingAddOn[],
    baseCents,
    addOnCents,
    totalCents: baseCents === null ? null : baseCents + addOnCents,
  };
}

export function vehicleSizeLabel(slug: string | undefined, value: string): string {
  if (slug === "interior-detail") return value === "SUV" ? "Mid Size" : value === "Truck" ? "Full Size" : "Sedan";
  if (["exterior-detail", "full-detail"].includes(slug || "")) return value === "Truck" ? "XL" : value;
  return value;
}
