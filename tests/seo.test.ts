import test from "node:test";
import assert from "node:assert/strict";
import { businessSchema, breadcrumbSchema, faqSchema, pageMetadata, serializeStructuredData, serviceSchema, structuredData, websiteSchema } from "../lib/seo";
import type { BusinessSettings, Service } from "../lib/platform/types";

const origin = "https://westloopceramics.com";
const business = {
  name: "West Loop Ceramics", address: "", phone: "", email: "", logo_url: "",
  instagram_url: "https://www.instagram.com/westloopautospa/", google_review_url: "",
  service_area: "West Loop, Chicago", days: [0, 1, 2, 3, 4, 5, 6],
  open_time: "08:00", close_time: "20:00", day_hours: [{ weekday: 0, open_time: "08:00", close_time: "17:00" }],
} as BusinessSettings;
const service = {
  id: "paint-correction-id", slug: "paint-correction", name: "Paint Correction", price_cents: 52500,
  pricing_mode: "starting",
} as Service;

test("page metadata keeps each canonical and social preview on its own route", () => {
  const metadata = pageMetadata({ title: "Paint Correction in Chicago", description: "Service description", path: "/services/paint-correction", image: "/brand/photos/paint-beading.webp" });
  assert.deepEqual(metadata.title, { absolute: "Paint Correction in Chicago | West Loop Ceramics" });
  assert.equal(metadata.alternates?.canonical, "/services/paint-correction");
  assert.equal(metadata.openGraph?.url, metadata.alternates?.canonical);
  assert.equal(metadata.openGraph?.description, "Service description");
  assert.equal(metadata.twitter?.description, "Service description");
  assert.deepEqual(metadata.openGraph?.images, [{ url: "/brand/photos/paint-beading.webp", alt: "West Loop Ceramics" }]);
});

test("business identity and service provider share one ID without inventing contact details", () => {
  const node = businessSchema(origin, business);
  assert.equal(node["@id"], "https://westloopceramics.com/#business");
  assert.deepEqual(serviceSchema(origin, service, "Polishing", "/paint.webp").provider, { "@id": node["@id"] });
  assert.deepEqual(websiteSchema(origin, business.name).publisher, { "@id": node["@id"] });
  assert.equal(node.address, undefined);
  assert.equal(node.telephone, undefined);
  assert.equal(node.aggregateRating, undefined);
  assert.equal(businessSchema(origin, { ...business, address: "West Loop, Chicago. Appointment location confirmed before your visit." }).address, undefined);
  const hours = node.openingHoursSpecification as Array<{ dayOfWeek: string; closes: string }>;
  assert.equal(hours.find((day) => day.dayOfWeek === "Sunday")?.closes, "17:00");
  assert.equal(hours.find((day) => day.dayOfWeek === "Saturday")?.closes, "20:00");
});

test("structured offers distinguish fixed prices, starting estimates, and quotes", () => {
  const starting = serviceSchema(origin, service, "Polishing", "/paint.webp").offers as Record<string, unknown>;
  assert.equal(starting.price, undefined);
  assert.equal(starting["@type"], "Offer");
  assert.deepEqual(starting.priceSpecification, { "@type": "PriceSpecification", minPrice: 525, priceCurrency: "USD" });
  const fixed = serviceSchema(origin, { ...service, pricing_mode: "fixed" }, "Polishing", "/paint.webp").offers as Record<string, unknown>;
  assert.equal(fixed.price, 525);
  assert.equal(fixed.priceSpecification, undefined);
  assert.equal(serviceSchema(origin, { ...service, pricing_mode: "quote" }, "Polishing", "/paint.webp").offers, undefined);
});

test("verified Chicago contact details produce an address without duplicating the city in the street", () => {
  const node = businessSchema(origin, { ...business, address: "1001 W Jackson Blvd, Chicago, IL 60607", phone: "+17733082038" });
  assert.deepEqual(node.address, {
    "@type": "PostalAddress", streetAddress: "1001 W Jackson Blvd", addressLocality: "Chicago",
    addressRegion: "IL", postalCode: "60607", addressCountry: "US",
  });
  assert.equal(node.telephone, "+17733082038");
});

test("breadcrumbs include home and service hierarchy without booking query parameters", () => {
  const node = breadcrumbSchema(origin, [{ name: "Services", path: "/services" }, { name: service.name, path: "/services/paint-correction" }]);
  assert.deepEqual(node.itemListElement, [
    { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
    { "@type": "ListItem", position: 2, name: "Services", item: `${origin}/services` },
    { "@type": "ListItem", position: 3, name: "Paint Correction", item: `${origin}/services/paint-correction` },
  ]);
});

test("FAQ structured data uses exact visible questions and escapes script boundaries", () => {
  const questions = [{ question: "Will every scratch disappear?", answer: "No. </script><script>alert('test')</script>" }];
  const node = faqSchema(origin, "/services/paint-correction", questions);
  const serialized = serializeStructuredData(structuredData([node]));
  assert.ok(!serialized.includes("</script>"));
  assert.equal(JSON.parse(serialized)["@graph"][0].mainEntity[0].acceptedAnswer.text, questions[0].answer);
  assert.equal(JSON.parse(serialized)["@graph"][0].mainEntity[0].name, questions[0].question);
});
