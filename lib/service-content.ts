import type { Service } from "./platform/types";

type Question = { question: string; answer: string };
type Step = { title: string; body: string };
export type ServiceContent = {
  eyebrow: string;
  headline: string;
  introduction: string;
  overview: string;
  image: string;
  imageAlt: string;
  imagePosition?: string;
  bestFor: string[];
  process: Step[];
  preparation: string[];
  faqs: Question[];
  related: string[];
  metadata: string;
};

// General coating/correction distinctions checked against Gtechniq's coating
// guide (https://gtechniq.com/ceramiccoatings/) and Meguiar's FAQ
// (https://www.meguiars.com/faq). These are educational sources, not supplied brands.
export const careStages = [
  { number: "01", title: "Clean", service: "Exterior Detail", slug: "exterior-detail", purpose: "Remove the everyday.", detail: "A hand wash lifts surface dirt. Wheel, tire and glass care bring the exterior together.", boundary: "For a cleaner car. Existing paint swirls may remain." },
  { number: "02", title: "Refine", service: "Paint Correction", slug: "paint-correction", purpose: "Bring back the reflection.", detail: "Machine polishing addresses suitable surface defects to improve paint clarity and depth.", boundary: "For dullness and swirls. Results depend on paint condition." },
  { number: "03", title: "Protect", service: "Ceramic Coating", slug: "ceramic-coating", purpose: "Make the finish easier to care for.", detail: "A coating adds a protective surface layer after preparation. It supports gloss and easier cleaning.", boundary: "For ongoing care. Regular washing is still essential." },
] as const;

export const serviceContent: Record<string, ServiceContent> = {
  "ceramic-coating": {
    eyebrow: "OUR SIGNATURE SURFACE PROTECTION",
    headline: "A beautiful finish.\nA better care routine.",
    introduction: "Ceramic protection starts with the surface beneath it. Thoughtful preparation, careful application and clear aftercare bring the whole finish together.",
    overview: "A ceramic coating forms a protective layer on a prepared surface. It can help water and dirt release more easily during washing and support the appearance of the finish. The right preparation depends on your paint, its history and how you use your car. We review those details before confirming the work.",
    image: "/portfolio/black-porsche-studio.jpg",
    imageAlt: "Black Porsche with crisp studio-light reflections across the paint",
    bestFor: ["Owners looking for easier routine exterior care", "A new-to-you car ready for a considered protection plan", "Paint you are happy with, or plan to refine before coating"],
    process: [
      { title: "Understand the surface", body: "Review paint condition, existing protection and the finish you want. Discuss whether separate correction would be worthwhile." },
      { title: "Prepare with purpose", body: "Complete the agreed surface preparation and panel wipe so the coating is applied to an appropriate, clean surface." },
      { title: "Apply with care", body: "Apply the coating and inspect the finish. Preparation and application are treated as one complete process." },
      { title: "Plan the first wash", body: "Confirm collection, curing and aftercare guidance for the coating applied to your vehicle." },
    ],
    preparation: ["Tell us about previous coatings, paint protection film or recent paintwork.", "Point out swirls, marks or panels you want us to assess before coating.", "Allow flexibility around collection and the initial cure guidance discussed for your car."],
    faqs: [
      { question: "Is paint correction included?", answer: "Ceramic coating includes the preparation shown in the service scope. Machine paint correction is a separate service unless it is specifically included in your confirmed quote. We review the paint first and explain any recommended additional work." },
      { question: "Will ceramic coating stop scratches or stone chips?", answer: "No. A ceramic coating does not make paint scratch-proof and is not impact protection against stone chips. Careful washing and sensible maintenance remain important." },
      { question: "How long will the coating last?", answer: "That depends on the coating selected, preparation, storage, use and maintenance. We discuss the applicable product and care requirements when we assess your vehicle rather than promise a one-size-fits-all lifespan." },
      { question: "Can I wash or drive the car straight away?", answer: "Collection and initial exposure or washing restrictions depend on the coating and application conditions. Follow the specific cure and aftercare instructions provided at handover." },
    ],
    related: ["paint-correction", "maintenance-detail", "exterior-detail"],
    metadata: "Explore ceramic coating in Chicago: surface preparation, application, aftercare, current starting prices and a clear consultation before work begins.",
  },
  "paint-correction": {
    eyebrow: "CLARITY, RESTORED",
    headline: "Let the paint\ncatch the light again.",
    introduction: "A closer look at the finish. Paint correction uses machine polishing to improve suitable surface defects and bring more clarity to the reflection.",
    overview: "Swirls and fine surface marks can soften the appearance of otherwise clean paint. Correction refines the finish rather than simply covering it. Paint condition, previous repairs and the depth of a defect determine what can be improved safely. We agree a realistic scope before polishing begins.",
    image: "/portfolio/black-porsche-studio.jpg",
    imageAlt: "Reflections following the hood and front fender of a black Porsche",
    bestFor: ["Visible swirls or light marks in glossy paint", "A finish that looks dull even after washing", "Refining the appearance before a ceramic coating"],
    process: [
      { title: "Inspect", body: "Look at the paint and discuss visible defects, previous repairs and the result you are hoping for." },
      { title: "Decontaminate", body: "Prepare the surface so polishing addresses the finish rather than working over contamination." },
      { title: "Refine", body: "Machine polish within the agreed scope, with the paint's condition guiding the approach." },
      { title: "Review", body: "Inspect the finish and discuss suitable ongoing care or a separate protection service." },
    ],
    preparation: ["Share any history of repainting, previous correction or existing protection.", "Identify specific marks you would like assessed.", "Mention matte or satin finishes before booking; conventional correction is not suitable for every finish."],
    faqs: [
      { question: "Can every scratch be removed?", answer: "No. Deep damage, chips and defects beyond the safely correctable surface may remain. The inspection helps distinguish improvements we can make from damage that may require paint repair." },
      { question: "Is this the same as a wash or wax?", answer: "A wash cleans the surface, while wax adds temporary protection. Paint correction uses polishing to refine suitable defects in the finish. Each serves a different purpose." },
      { question: "Should I coat the car after correction?", answer: "Coating can be a useful next step once you are happy with the finish. It is quoted and booked separately unless your confirmed scope includes both services." },
    ],
    related: ["ceramic-coating", "exterior-detail", "maintenance-detail"],
    metadata: "Paint correction in Chicago for suitable swirls, light surface marks and dull finishes. Explore the process, current starting price and booking options.",
  },
  "exterior-detail": {
    eyebrow: "THE EVERYDAY, RECONSIDERED",
    headline: "Clean lines.\nA considered finish.",
    introduction: "An attentive exterior reset, from the first hand wash to the final glass and tire details.",
    overview: "Road dirt, dusty wheels and marked glass can hide the lines you love about your car. An exterior detail brings those surfaces back into focus. It is a straightforward choice for everyday exterior care, with suitable finishing protection confirmed for your vehicle.",
    image: "/portfolio/black-mercedes-rear.jpg",
    imageAlt: "Rear three-quarter view of a dark Mercedes coupe indoors",
    bestFor: ["Everyday road dirt and dusty wheels", "A car whose exterior needs attention between fuller details", "An exterior refresh without interior cleaning"],
    process: [
      { title: "Review the finish", body: "Identify special finishes, existing protection and any areas that need attention." },
      { title: "Wash and clean", body: "Hand wash the exterior and clean wheels, tires and exterior glass." },
      { title: "Finish the details", body: "Complete the tire dressing and suitable wax treatment listed in your service scope." },
      { title: "Walk around", body: "Review the exterior and discuss anything that would benefit from a separate treatment." },
    ],
    preparation: ["Tell us about matte paint, wraps or existing ceramic protection.", "Point out damaged trim, loose fittings or areas that need special handling.", "Mention stubborn marks or deposits when you book so the scope can be reviewed."],
    faqs: [
      { question: "Does an exterior detail remove swirls?", answer: "A hand wash removes surface dirt; it does not correct scratches or swirls in paint. Explore Paint Correction if improving those marks is your priority." },
      { question: "Is the interior included?", answer: "This service focuses on the exterior. Choose Full Detail for combined interior and exterior care, or Interior Detail for the cabin alone." },
      { question: "Can you work around an existing coating?", answer: "Let us know which protection is already on the car. We can discuss appropriate care and whether the listed wax step is suitable before work begins." },
    ],
    related: ["full-detail", "paint-correction", "maintenance-detail"],
    metadata: "A considered exterior car detail in Chicago, with hand washing, wheel and tire care, exterior glass and suitable finishing protection. View current pricing.",
  },
  "interior-detail": {
    eyebrow: "A BETTER PLACE TO SPEND TIME",
    headline: "A fresh start\nfrom the inside.",
    introduction: "The everyday touchpoints deserve attention too. Restore a cleaner, more comfortable feel to the space you use most.",
    overview: "An interior detail brings together vacuuming, cleaning of seats and carpets, and care for the dashboard, doors and vents. Stains and odors are reviewed as part of the condition assessment. We match expectations to the materials and the condition of your cabin.",
    image: "/portfolio/white-bmw-interior.jpg",
    imageAlt: "BMW cabin with white seats, dark dashboard and center console",
    bestFor: ["An everyday cabin ready for a thorough refresh", "Dust, crumbs and marks on frequently touched surfaces", "Interior care without an exterior appointment"],
    process: [
      { title: "Look inside", body: "Review the materials, areas of concern and any sensitive or damaged surfaces." },
      { title: "Remove loose dirt", body: "Vacuum the cabin before addressing seats, carpets and interior surfaces." },
      { title: "Work through the details", body: "Clean the dashboard, doors and vents, with attention to the stains and odors discussed." },
      { title: "Check the cabin", body: "Review the result and explain any remaining marks or drying considerations." },
    ],
    preparation: ["Remove valuables and as many personal belongings as possible.", "Let us know the source and age of stains or odors where you can.", "Tell us about child seats and sensitive trim before the appointment."],
    faqs: [
      { question: "Will every stain or odor disappear?", answer: "Results depend on the material and how long the contamination has been present. Some discoloration or odor sources cannot be fully resolved by detailing. We discuss likely outcomes after reviewing the cabin." },
      { question: "When should I choose Deep Interior Cleaning?", answer: "Consider the deeper service for embedded dirt, substantial pet hair or areas that may need extraction. Describe the condition when booking so we can help select an appropriate scope." },
      { question: "Do I need to empty the car?", answer: "Please remove personal belongings and valuables so surfaces are accessible. Tell us in advance if anything needs to remain in the vehicle." },
    ],
    related: ["deep-interior-cleaning", "full-detail", "maintenance-detail"],
    metadata: "Interior car detailing in Chicago with vacuuming, seat and carpet cleaning, dashboard and vent care, and condition-based stain treatment. View prices and book.",
  },
  "full-detail": {
    eyebrow: "THE COMPLETE RESET",
    headline: "The whole car.\nConsidered together.",
    introduction: "A complete interior and exterior detail for the days when your car needs a fresh beginning, inside and out.",
    overview: "Full Detail combines cabin care with an exterior hand wash, wheels and tires, trim attention and wax protection. It is a practical way to address the whole car in one appointment. More involved paint correction, ceramic coating or deep interior work can be discussed separately if needed.",
    image: "/portfolio/black-porsche-driveway.jpg",
    imageAlt: "Black Porsche parked on a stone driveway with reflections across its bodywork",
    bestFor: ["An interior and exterior reset in one visit", "A recently purchased vehicle you want to make your own", "Preparing a cared-for car for a new season or occasion"],
    process: [
      { title: "Agree the priorities", body: "Review the whole vehicle and identify the areas that matter most to you." },
      { title: "Reset the cabin", body: "Complete the interior detail, working through the agreed cabin surfaces." },
      { title: "Refresh the exterior", body: "Hand wash, address the wheels and tires, refresh the trim and apply suitable wax protection." },
      { title: "Bring it together", body: "Review the car as a whole and discuss how to maintain the finish." },
    ],
    preparation: ["Remove valuables and loose belongings from the cabin and cargo area.", "Share any particular stains, paint concerns or existing coatings.", "Plan around the appointment estimate and confirm collection arrangements."],
    faqs: [
      { question: "Does Full Detail include paint correction?", answer: "No. Full Detail focuses on cleaning and the listed finishing steps. Machine polishing is offered through Paint Correction, with its own assessment and price." },
      { question: "Is ceramic coating included?", answer: "The listed protection for Full Detail is wax. Ceramic Coating is a separate surface-protection service with different preparation and aftercare requirements." },
      { question: "What if the interior needs more extensive work?", answer: "Tell us about heavy staining, pet hair or embedded dirt before the visit. We can assess whether Deep Interior Cleaning or an adjusted scope would better suit the car." },
    ],
    related: ["ceramic-coating", "deep-interior-cleaning", "maintenance-detail"],
    metadata: "Full car detailing in Chicago: interior care, an exterior hand wash, wheels, trim and wax protection in one appointment. View live pricing and availability.",
  },
  "deep-interior-cleaning": {
    eyebrow: "TIME FOR A DEEPER RESET",
    headline: "More attention\nwhere life leaves a mark.",
    introduction: "For cabins that need more than a routine refresh. Focused cleaning, extraction and attention to the details that take time.",
    overview: "Embedded dirt, pet hair and old spills each call for a different approach. Deep Interior Cleaning starts with the condition of your materials, then focuses on the areas that need extra work. The final scope and estimate reflect the cabin we are actually treating.",
    image: "/portfolio/interior-red-seats.jpg",
    imageAlt: "Open BMW cabin showing red seats and the center console",
    imagePosition: "50% 64%",
    bestFor: ["Embedded dirt or substantial pet hair", "Stains that need a closer assessment", "A cabin that needs more attention than a routine detail"],
    process: [
      { title: "Assess the materials", body: "Review stains, wear, odor concerns and the condition of each surface before selecting the approach." },
      { title: "Address the buildup", body: "Work through loose debris and pet hair so the deeper cleaning can reach the affected areas." },
      { title: "Clean with focus", body: "Use the agreed extraction and stain treatments where the materials and condition permit." },
      { title: "Review and dry", body: "Check the cabin and discuss drying, collection and realistic outcomes for remaining marks." },
    ],
    preparation: ["Empty the cabin and cargo area as far as possible.", "Describe stains, spills, pet hair and persistent odors when booking.", "Tell us about water intrusion or damaged materials so we can review suitability before the visit."],
    faqs: [
      { question: "Why is this a starting price?", answer: "Vehicle size, material condition and the extent of pet hair, staining or embedded dirt affect the work involved. We confirm the final scope and any price changes before starting." },
      { question: "Will the seats and carpets be dry at collection?", answer: "Drying time varies with materials, treatment and conditions. Confirm collection arrangements with us and follow any ventilation or drying guidance provided." },
      { question: "Can extraction repair worn or discolored material?", answer: "Cleaning can address contamination but does not repair tears, worn coatings or permanent discoloration. Those limitations are considered during the assessment." },
    ],
    related: ["interior-detail", "full-detail", "maintenance-detail"],
    metadata: "Deep interior car cleaning in Chicago for embedded dirt, pet hair and condition-based stain treatment. Explore extraction, preparation and current starting prices.",
  },
  "maintenance-detail": {
    eyebrow: "KEEP THE FEELING",
    headline: "Good care\nhas a rhythm.",
    introduction: "A care routine built around your car, its condition and the way you drive. Keep the next visit straightforward.",
    overview: "Maintenance detailing is about keeping up with the interior and exterior rather than waiting for another full reset. We review the current condition and any existing protection, then discuss suitable visit frequency and scope. Pricing is agreed after that conversation.",
    image: "/portfolio/silver-porsche-street.jpg",
    imageAlt: "Side profile of a silver Porsche parked along a city street",
    bestFor: ["A recently detailed vehicle you want to keep in good condition", "Owners building an ongoing exterior and cabin care routine", "A coated car with a maintenance plan to follow"],
    process: [
      { title: "Review the starting point", body: "Check the current condition and note any coatings, finishes or care instructions already in place." },
      { title: "Choose the routine", body: "Discuss how the car is driven and stored, then agree a useful schedule and service scope." },
      { title: "Care for the car", body: "Complete the interior and exterior upkeep included in your agreed visit." },
      { title: "Plan ahead", body: "Review any changing needs before arranging a future appointment." },
    ],
    preparation: ["Share the date and scope of the last detail if you know them.", "Bring any existing coating aftercare instructions.", "Describe your usual mileage, parking conditions and preferred appointment rhythm."],
    faqs: [
      { question: "Is this a subscription or membership?", answer: "The service is currently arranged by consultation. Visit frequency, scope and pricing are discussed for your vehicle; no subscription or automatic recurring charge is advertised here." },
      { question: "How often should I book?", answer: "The right interval depends on use, storage, the season and the condition you want to maintain. We can help plan a routine after reviewing your car." },
      { question: "Can I start with a very dirty vehicle?", answer: "We may recommend an initial detail to establish a suitable starting condition. Any additional service and cost are discussed before work begins." },
    ],
    related: ["ceramic-coating", "full-detail", "exterior-detail"],
    metadata: "Plan ongoing interior and exterior car care in Chicago. Maintenance detail scope, frequency and pricing are discussed after reviewing your vehicle.",
  },
  "headlight-restoration": {
    eyebrow: "A CLEARER FINISH",
    headline: "Bring clarity\nback to the front.",
    introduction: "Focused care for suitable cloudy or weathered headlight surfaces, with preparation, restoration and a protective finish.",
    overview: "Surface deterioration can leave a headlight looking hazy even when the car is clean. Restoration addresses suitable exterior lens condition. We first review whether the concern is on the outside of the lens or involves damage that detailing cannot resolve.",
    image: "/portfolio/black-porsche-studio.jpg",
    imageAlt: "Front of a black Porsche showing its headlights and hood",
    imagePosition: "60% 60%",
    bestFor: ["Cloudiness or weathering on a suitable exterior lens surface", "Headlights that look tired beside an otherwise cared-for finish", "A focused restoration alongside general exterior care"],
    process: [
      { title: "Check suitability", body: "Inspect the lens and distinguish exterior surface deterioration from internal or structural issues." },
      { title: "Prepare the area", body: "Prepare the headlights and surrounding area for the agreed restoration work." },
      { title: "Restore the surface", body: "Address the suitable exterior lens surface within the confirmed scope." },
      { title: "Finish and review", body: "Apply the listed protective finish and explain any remaining limitations or care considerations." },
    ],
    preparation: ["Tell us if a lamp is cracked, leaking or has condensation inside.", "Mention any previous lens repair or aftermarket treatment.", "Describe whether the issue is haziness, a damaged lens or a light that is not working."],
    faqs: [
      { question: "Can you repair a cracked or leaking headlight?", answer: "Headlight restoration is a surface treatment. It does not repair cracks, seals, internal condensation, bulbs or electrical faults. Those issues may need a separate repair specialist." },
      { question: "Will the headlights look completely new?", answer: "Improvement depends on the material and the extent and location of deterioration. We review the lenses before agreeing the work, and permanent damage may remain." },
      { question: "Can I combine this with an exterior detail?", answer: "Tell us you are interested in both when booking. We can confirm the combined scope, appointment time and cost before work begins." },
    ],
    related: ["exterior-detail", "full-detail", "paint-correction"],
    metadata: "Headlight restoration in Chicago for suitable cloudy exterior lens surfaces. Learn about preparation, protective finishing, limitations and starting prices.",
  },
};

export function getServiceContent(service: Service): ServiceContent {
  return serviceContent[service.slug] ?? {
    eyebrow: service.category,
    headline: service.name,
    introduction: service.description,
    overview: "Every appointment starts with your vehicle. We review its condition, discuss your priorities and confirm the service scope before work begins.",
    image: "/portfolio/black-porsche-studio.jpg",
    imageAlt: "Black Porsche under studio lighting",
    bestFor: ["Owners looking for a service tailored to their vehicle", "A clear conversation about condition, scope and care"],
    process: [
      { title: "Review", body: "Tell us about your vehicle and the areas you would like us to assess." },
      { title: "Agree", body: "Confirm the included work, appointment requirements and any changes to the estimate." },
      { title: "Care", body: "Complete the agreed service and discuss the result and next steps." },
    ],
    preparation: ["Share any previous treatments or areas of concern.", "Confirm appointment and collection details before your visit."],
    faqs: [{ question: "How is the final scope confirmed?", answer: "We review the vehicle and discuss any adjustments to the listed service before work begins." }],
    related: ["ceramic-coating", "full-detail", "maintenance-detail"],
    metadata: service.description,
  };
}

export function servicePrice(service: Service): string {
  if (service.pricing_mode === "quote") return "By consultation";
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: service.price_cents % 100 ? 2 : 0 }).format(service.price_cents / 100);
  return `${service.pricing_mode === "starting" ? "From " : ""}${amount}`;
}

export function serviceDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "", remainder ? `${remainder} min` : ""].filter(Boolean).join(" ") || "Confirmed on booking";
}
