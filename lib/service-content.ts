import type { Service } from "./platform/types";

type Question = { question: string; answer: string };
type Step = { title: string; body: string };
type ServiceGuide = {
  eyebrow: string;
  heading: string;
  introduction: string;
  choices: { label: string; title: string; body: string; points: string[] }[];
  note: string;
  boundaries: Step[];
};
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
  guide?: ServiceGuide;
};

// General coating/correction distinctions checked against Gtechniq's coating
// guide (https://gtechniq.com/ceramiccoatings/) and Meguiar's FAQ
// (https://www.meguiars.com/faq). Polishing stages/preparation also checked against
// https://gtechniq.com/service-builder/auto-service-builder-us/ and
// https://gtechniq.com/5-common-diy-paint-correction-mistakes/.
// These are educational sources, not supplied brands or certifications.
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
    image: "/brand/photography/ceramic-coating.webp",
    imageAlt: "Ceramic coating applicator moving across graphite paint under inspection lights",
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
    eyebrow: "PAINT CORRECTION IN CHICAGO",
    headline: "Let the paint\ncatch the light again.",
    introduction: "When a freshly washed car still looks hazy, the paint may need more than cleaning. Carefully assessed machine polishing can soften suitable swirls and fine marks, bringing clarity back to the reflection.",
    overview: "Paint correction works on defects in glossy paint rather than dirt sitting on top of it. Abrasive polishing refines a small amount of the surface, so the goal is a worthwhile improvement while preserving the finish. Paint history, defect depth and the condition of each panel guide the work. We discuss what can improve, what should remain and the agreed price before starting.",
    image: "/brand/photography/paint-correction.webp",
    imageAlt: "Professional machine polishing black paint beneath vertical inspection lights",
    bestFor: ["Fine wash swirls visible in sunlight or direct lighting", "Glossy paint that still looks hazy after a careful wash", "A used car with paintwork you want assessed before investing in protection", "Refining the appearance before a separately agreed ceramic coating"],
    process: [
      { title: "Assess the paint", body: "Review swirls, deeper marks, previous polishing and repaired panels. Agree priorities and realistic limits for the finish." },
      { title: "Prepare the surface", body: "Wash and decontaminate the paint as required. A clean surface allows the polishing approach to be assessed without working over bonded dirt." },
      { title: "Polish with purpose", body: "Choose the polishing stages around the paint's response and agreed scope. More aggressive work is not automatically the better choice." },
      { title: "Inspect and protect", body: "Review clarity and any remaining defects. Confirm the protection included in your scope and how to maintain the finish after collection." },
    ],
    preparation: ["Share the vehicle's age and any history of repainting, polishing, coatings or paint protection film.", "Point out the marks that bother you most. Clear photos help start the conversation; the car still needs an in-person assessment.", "Tell us about matte or satin paint, wraps and damaged finishes before booking so we can discuss appropriate care."],
    guide: {
      eyebrow: "CHOOSING THE RIGHT LEVEL",
      heading: "One step or more?\nStart with the paint.",
      introduction: "Polishing stages describe the approach, not a guaranteed result. You do not need to diagnose your paint or choose a package yourself: the condition and the finish you want guide the recommendation.",
      choices: [
        { label: "LIGHTER REFINEMENT", title: "Single-step polishing", body: "One polishing stage balances improvement and finish quality. It may suit paint with lighter swirls or mild haze when a stronger gloss is the main goal.", points: ["Focuses on clarity and an overall improvement", "Deeper isolated marks may remain", "Suitability depends on how the paint responds"] },
        { label: "MORE INVOLVED REFINEMENT", title: "Multi-step correction", body: "A more involved approach separates defect reduction from finer finishing. It may be appropriate for more noticeable defects when the paint can support the additional work.", points: ["A correction stage followed by finer polishing", "More time and preparation may be needed", "Scope and estimate agreed after assessment"] },
      ],
      note: "These are approaches we can discuss, not two fixed packages. The listed service price does not promise a specific number of stages or a percentage of defect removal.",
      boundaries: [
        { title: "What may improve", body: "Suitable wash swirls, fine surface scratches and polishing haze. Some water marks or dullness may respond, depending on their cause and depth." },
        { title: "What polishing cannot replace", body: "Paint repair for chips, deep scratches, peeling clear coat or damaged paint. Chasing every mark can remove too much material; some defects are best left alone." },
        { title: "Keep the result looking good", body: "Use careful washing and clean, suitable wash materials. Correction does not make paint scratch-proof, and ceramic coating is separate unless agreed in your scope." },
      ],
    },
    faqs: [
      { question: "Can every scratch be removed?", answer: "No. Deep damage, chips and defects beyond the safely correctable surface may remain. The inspection helps distinguish improvements we can make from damage that may require paint repair." },
      { question: "Is this the same as a wash or wax?", answer: "A wash cleans the surface, while wax adds temporary protection. Paint correction uses polishing to refine suitable defects in the finish. Each serves a different purpose." },
      { question: "Do I need single-step or multi-step correction?", answer: "That depends on the defects, paint condition and the result you want. A single polishing stage can be suitable for lighter refinement; more involved correction separates defect reduction and finishing. We assess the car before agreeing the approach, timing and price." },
      { question: "How long does paint correction take?", answer: "The appointment estimate above is a starting point for planning. Vehicle size, paint condition and the polishing scope can change the time required. We confirm the expected collection time when the work is agreed." },
      { question: "Can matte paint, wraps or paint protection film be corrected?", answer: "Conventional polishing is intended for suitable glossy paint. Matte and satin finishes, wraps and film need their own care approach. Tell us what is on the car before choosing this service." },
      { question: "Should I coat the car after correction?", answer: "Coating can be a useful next step once you are happy with the finish. It is quoted and booked separately unless your confirmed scope includes both services." },
    ],
    related: ["ceramic-coating", "full-detail", "maintenance-detail"],
    metadata: "Paint correction in Chicago's West Loop. Understand swirl removal, single-step polishing, multi-step assessment and realistic results. See current pricing and book.",
  },
  "exterior-detail": {
    eyebrow: "THE EVERYDAY, RECONSIDERED",
    headline: "Clean lines.\nA considered finish.",
    introduction: "An attentive exterior reset, from the first hand wash to the final glass and tire details.",
    overview: "Road dirt, dusty wheels and marked glass can hide the lines you love about your car. An exterior detail brings those surfaces back into focus. It is a straightforward choice for everyday exterior care, with suitable finishing protection confirmed for your vehicle.",
    image: "/brand/photography/exterior-detail.webp",
    imageAlt: "Freshly detailed midnight-blue performance coupe in a professional studio",
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
    image: "/brand/photography/interior-detail.webp",
    imageAlt: "Immaculate saddle leather luxury cabin receiving a final detail",
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
      { question: "When should I choose Extensive Interior Detail?", answer: "Consider the more extensive service for embedded dirt, substantial pet hair or areas that may need extraction. Describe the condition when booking so we can help select an appropriate scope." },
      { question: "Do I need to empty the car?", answer: "Please remove personal belongings and valuables so surfaces are accessible. Tell us in advance if anything needs to remain in the vehicle." },
    ],
    related: ["deep-interior-cleaning", "full-detail", "maintenance-detail"],
    metadata: "Interior car detailing in Chicago with vacuuming, seat and carpet cleaning, dashboard and vent care, and condition-based stain treatment. View prices and book.",
  },
  "full-detail": {
    eyebrow: "FULL SERVICE DETAILING IN CHICAGO",
    headline: "The whole car.\nConsidered together.",
    introduction: "Interior and exterior care in one visit. Full service detailing brings the cabin, paintwork, wheels and finishing touches together for a car that feels cared for throughout.",
    overview: "Full Detail combines cabin care with an exterior hand wash, wheels and tires, trim attention and wax protection. It is a practical way to address the whole car in one appointment. More involved paint correction, ceramic coating or extensive interior work can be discussed separately if needed.",
    image: "/brand/photography/full-detail-studio.webp",
    imageAlt: "Graphite luxury sedan receiving a final exterior detail in a Chicago studio",
    bestFor: ["An interior and exterior reset in one visit", "A recently purchased vehicle you want to make your own", "Preparing a cared-for car for a new season or occasion"],
    process: [
      { title: "Agree the priorities", body: "Review the whole vehicle and identify the areas that matter most to you." },
      { title: "Reset the cabin", body: "Complete the interior detail, working through the agreed cabin surfaces." },
      { title: "Refresh the exterior", body: "Hand wash, address the wheels and tires, refresh the trim and apply suitable wax protection." },
      { title: "Bring it together", body: "Review the car as a whole and discuss how to maintain the finish." },
    ],
    preparation: ["Remove valuables and loose belongings from the cabin and cargo area.", "Share any particular stains, paint concerns or existing coatings.", "Plan around the appointment estimate and confirm collection arrangements."],
    guide: {
      eyebrow: "INSIDE AND OUT",
      heading: "One appointment.\nTwo sides of a cleaner car.",
      introduction: "Choose Full Detail when both the cabin and exterior need attention. The service brings the two areas together; the included steps above remain the reference for your appointment.",
      choices: [
        { label: "THE CABIN", title: "Interior attention", body: "A whole-cabin clean built around the surfaces you use every day, with methods chosen for the material and its condition.", points: ["Vacuuming and accessible interior surfaces", "Seat, carpet, dashboard, door and vent care within the agreed scope", "Discuss stains and odor concerns before the visit"] },
        { label: "THE EXTERIOR", title: "A considered finish", body: "An exterior reset that brings together clean bodywork, wheels and tires, with the finishing protection listed for your service.", points: ["Exterior hand wash and wheel and tire care", "Trim attention and the listed wax protection", "Existing coatings or special finishes reviewed first"] },
      ],
      note: "Full service describes combined interior and exterior detailing. Machine paint correction, ceramic coating and more extensive interior restoration are separate unless explicitly included in your confirmed scope.",
      boundaries: [
        { title: "A clean car can still have swirls", body: "If the paint looks marked after washing, Paint Correction is the service to discuss. A full detail does not promise scratch or swirl removal." },
        { title: "Heavy interior concerns need a closer look", body: "Significant pet hair, embedded stains or persistent odors may require Extensive Interior Detail or additional work. Share the condition so the scope can be agreed first." },
        { title: "Protect it on your terms", body: "Wax protection and ceramic coating are different services. If you want ceramic protection, we discuss preparation, pricing and aftercare separately." },
      ],
    },
    faqs: [
      { question: "Does Full Detail include paint correction?", answer: "No. Full Detail focuses on cleaning and the listed finishing steps. Machine polishing is offered through Paint Correction, with its own assessment and price." },
      { question: "Is ceramic coating included?", answer: "The listed protection for Full Detail is wax. Ceramic Coating is a separate surface-protection service with different preparation and aftercare requirements." },
      { question: "What if the interior needs more extensive work?", answer: "Tell us about heavy staining, pet hair or embedded dirt before the visit. We can assess whether Extensive Interior Detail or an adjusted scope would better suit the car." },
      { question: "Is a full detail the same as a car wash?", answer: "A full detail gives attention to both interior and exterior surfaces, with the cleaning and finishing steps listed above. It is broader than an exterior wash, but it does not automatically include paint correction or specialist restoration." },
      { question: "Is this a good choice before selling a car?", answer: "It can be a useful way to present a cleaner cabin and exterior. Tell us about your timing and priorities. Detailing does not repair worn materials or paint damage, and we do not promise a change in resale value." },
    ],
    related: ["paint-correction", "deep-interior-cleaning", "ceramic-coating"],
    metadata: "Full service car detailing in Chicago's West Loop. Explore interior and exterior care, wheel and trim attention, wax protection, inclusions and current booking prices.",
  },
  "deep-interior-cleaning": {
    eyebrow: "TIME FOR A DEEPER RESET",
    headline: "More attention\nwhere life leaves a mark.",
    introduction: "For cabins that need more than a routine refresh. Focused cleaning, extraction and attention to the details that take time.",
    overview: "Embedded dirt, pet hair and old spills each call for a different approach. Extensive Interior Detail starts with the condition of your materials, then focuses on the areas that need extra work. The final scope and estimate reflect the cabin we are actually treating.",
    image: "/brand/photography/deep-interior.webp",
    imageAlt: "Professional extraction and pet-hair removal on a premium SUV carpet",
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
    metadata: "Extensive interior car detailing in Chicago for embedded dirt, pet hair and condition-based stain treatment. Explore extraction, preparation and current starting prices.",
  },
  "maintenance-detail": {
    eyebrow: "KEEP THE FEELING",
    headline: "Good care\nhas a rhythm.",
    introduction: "A care routine built around your car, its condition and the way you drive. Keep the next visit straightforward.",
    overview: "Maintenance detailing is about keeping up with the interior and exterior rather than waiting for another full reset. We review the current condition and any existing protection, then discuss suitable visit frequency and scope. Pricing is agreed after that conversation.",
    image: "/brand/photography/exterior-detail.webp",
    imageAlt: "Maintained midnight-blue performance coupe with clean paint, wheels and glass",
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
    image: "/brand/photography/headlight-restoration.webp",
    imageAlt: "Restored modern headlight lens receiving a final protective wipe",
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
    image: "/brand/photography/full-detail-studio.webp",
    imageAlt: "Freshly detailed graphite luxury sedan in a refined automotive studio",
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
