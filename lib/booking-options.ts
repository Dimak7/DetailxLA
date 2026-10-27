import { priceFor, type Service } from "./platform/types";

export type BookingAddOn = {
  id: string;
  name: string;
  priceCents: number | null;
  description: string;
};

export type ServicePackage = {
  id: string;
  name: string;
  priceCents: number | null;
  description: string;
};

export type BookingServiceChoice = {
  service_id: string;
  service_package?: string;
  addons?: string[];
};

const addOns: Record<string, BookingAddOn> = {
  "engine-bay": { id: "engine-bay", name: "Engine Bay", priceCents: 6000, description: "A careful clean and finish for accessible engine-bay surfaces." },
  "ceramic-sealant": { id: "ceramic-sealant", name: "Ceramic Sealant", priceCents: 15000, description: "Gloss and water-repellent protection that lasts up to 6 months." },
  "tar-removal": { id: "tar-removal", name: "Tar Removal", priceCents: null, description: "Targets bonded road tar that a routine hand wash cannot safely lift." },
  "iron-removal": { id: "iron-removal", name: "Iron Removal", priceCents: null, description: "Targeted treatment for embedded iron particles. Priced after checking the paint condition." },
  "trim-restoration": { id: "trim-restoration", name: "Trim Restoration", priceCents: 4500, description: "Revives faded exterior trim for a darker, more even appearance." },
  "overspray-removal": { id: "overspray-removal", name: "Overspray Removal", priceCents: 17500, description: "Condition-based removal of suitable bonded paint mist and contamination." },
  "interior-trim-polish": { id: "interior-trim-polish", name: "Interior Trim Polish", priceCents: 8000, description: "Refines suitable gloss trim to reduce light haze and improve clarity." },
  "headlight-restoration": { id: "headlight-restoration", name: "Headlight Restoration", priceCents: 15000, description: "Restore clarity and add protection to both headlights. Price includes the pair." },
  "window-polish": { id: "window-polish", name: "Window Polish", priceCents: 22500, description: "Deep glass refinement for suitable mineral deposits and bonded contamination." },
  "chrome-polish": { id: "chrome-polish", name: "Chrome Polish", priceCents: 12500, description: "Restores clarity and shine to suitable exterior chrome surfaces." },
  "exhaust-tip-polish": { id: "exhaust-tip-polish", name: "Exhaust Tip Polish", priceCents: 2500, description: "Cleans and refines accessible exhaust tips for a crisp finishing detail." },
  "hair-removal": { id: "hair-removal", name: "Hair Removal", priceCents: 7500, description: "Additional time and tools for embedded pet hair throughout the cabin." },
  "heavy-soil": { id: "heavy-soil", name: "Heavy Soil / Stains", priceCents: 7500, description: "Extra treatment for heavily soiled areas and suitable stubborn stains." },
  "bio-clean": { id: "bio-clean", name: "Bio Clean", priceCents: 15000, description: "A deeper condition-based interior cleaning for biological contamination." },
  ozone: { id: "ozone", name: "Ozone Odor Treatment", priceCents: null, description: "An odor-treatment cycle after the source has been cleaned and removed." },
  "car-seat": { id: "car-seat", name: "Car Seat", priceCents: 1000, description: "Surface cleaning for one removable child car seat, when appropriate." },
};

const serviceAddOns: Record<string, string[]> = {
  "interior-detail": ["hair-removal", "heavy-soil", "bio-clean", "ozone", "car-seat", "interior-trim-polish"],
  "deep-interior-cleaning": ["bio-clean", "ozone", "car-seat", "interior-trim-polish"],
  "exterior-detail": ["ceramic-sealant", "tar-removal", "iron-removal", "trim-restoration", "engine-bay", "headlight-restoration", "exhaust-tip-polish"],
  "full-detail": ["ceramic-sealant", "engine-bay", "headlight-restoration", "hair-removal", "heavy-soil", "ozone", "tar-removal", "iron-removal"],
  "ceramic-coating": ["trim-restoration", "window-polish", "chrome-polish", "exhaust-tip-polish"],
  "paint-correction": ["ceramic-sealant", "trim-restoration", "headlight-restoration", "window-polish", "chrome-polish", "exhaust-tip-polish"],
  "headlight-restoration": ["ceramic-sealant"],
};

const packages: Record<string, ServicePackage[]> = {
  "ceramic-coating": [
    { id: "ceramic-2-year", name: "2 Year", priceCents: 55000, description: "Our entry protection package, starting at $550 after paint assessment." },
    { id: "ceramic-5-year", name: "5 Year", priceCents: 125000, description: "Longer-term protection, starting at $1,250 after paint assessment." },
    { id: "ceramic-10-year", name: "10 Year", priceCents: 175000, description: "Our longest-term package, starting at $1,750 after paint assessment." },
  ],
  "paint-correction": [
    { id: "correction-level-1", name: "Level 1 · 60% Correction", priceCents: 52500, description: "A focused refinement for lighter swirls, haze, and improved gloss." },
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
  if (!availablePackages.length && packageId) throw new Error("Choose a valid service package.");

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
    knownCents: (baseCents ?? 0) + addOnCents,
    totalCents: baseCents === null || selectedAddOns.some((item) => item?.priceCents === null) ? null : baseCents + addOnCents,
  };
}

/** Price every selected service from the catalogue; never trust a client total. */
export function bookingCartSelection(
  services: Service[],
  vehicleType: string,
  choices: BookingServiceChoice[],
) {
  if (!choices.length || choices.length > 12)
    throw new Error("Choose between one and twelve services.");
  if (new Set(choices.map((choice) => choice.service_id)).size !== choices.length)
    throw new Error("Choose each service only once.");
  const selectedServices = choices.map((choice) => {
    const service = services.find((item) => item.id === choice.service_id && item.active);
    if (!service) throw new Error("One of your selected services is no longer available.");
    return service;
  });
  const upgradeIds = new Set<string>();
  const items = choices.map((choice, index) => {
    const service = selectedServices[index];
    const selection = bookingSelection(service, vehicleType, choice.service_package, choice.addons);
    for (const addOn of selection.selectedAddOns) {
      if (upgradeIds.has(addOn.id))
        throw new Error(`${addOn.name} is already included as an upgrade. Choose it only once.`);
      if (selectedServices.some((item) => item.slug === addOn.id))
        throw new Error(`${addOn.name} is already selected as a service. Remove the duplicate upgrade.`);
      upgradeIds.add(addOn.id);
    }
    return { service, ...selection };
  });
  return {
    items,
    totalCents: items.some((item) => item.totalCents === null)
      ? null
      : items.reduce((sum, item) => sum + item.totalCents!, 0),
    knownCents: items.reduce((sum, item) => sum + item.knownCents, 0),
    durationMinutes: items.reduce((sum, item) => sum + item.service.duration_minutes, 0),
    requiresQuote: items.some((item) => item.totalCents === null || item.service.pricing_mode === "quote" || item.service.slug === "ceramic-coating"),
  };
}

export function vehicleSizeLabel(slug: string | undefined, value: string): string {
  if (!value) return "Choose a size";
  if (slug === "interior-detail") return value === "SUV" ? "Mid Size" : value === "Truck" ? "Full Size" : "Sedan";
  if (["exterior-detail", "full-detail"].includes(slug || "")) return value === "Truck" ? "XL" : value;
  return value;
}
