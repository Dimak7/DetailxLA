import type { Metadata } from "next";
import { BRAND_DESCRIPTION, BRAND_NAME } from "./brand";
import { openingHoursSpecification } from "./platform/business-hours";
import type { BusinessSettings, Service } from "./platform/types";

export const SEO_DESCRIPTION = BRAND_DESCRIPTION;

type PageMetadataInput = {
  title: string;
  description: string;
  path: string;
  image?: string;
  imageAlt?: string;
  absoluteTitle?: boolean;
};

/** Set every share field per page: nested Next metadata does not merge field by field. */
export function pageMetadata({ title, description, path, image = "/brand/social-preview.jpg", imageAlt = BRAND_NAME, absoluteTitle = false }: PageMetadataInput): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} | ${BRAND_NAME}`;
  return {
    title: { absolute: fullTitle },
    description,
    alternates: { canonical: path },
    openGraph: {
      title: fullTitle,
      description,
      url: path,
      siteName: BRAND_NAME,
      locale: "en_US",
      type: "website",
      images: [{ url: image, alt: imageAlt }],
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [image] },
  };
}

type SchemaNode = Record<string, unknown>;
type Question = { question: string; answer: string };

const absolute = (origin: string, path: string) => new URL(path, origin).href;
const businessId = (origin: string) => absolute(origin, "/#business");
const websiteId = (origin: string) => absolute(origin, "/#website");

export function structuredData(nodes: SchemaNode[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}

/** Escape HTML parsing characters even when names or descriptions come from the catalogue. */
export function serializeStructuredData(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function businessSchema(origin: string, business: BusinessSettings): SchemaNode {
  const address = business.address.trim();
  // A placeholder such as “location confirmed before your visit” is not a postal address.
  const hasStreetAddress = /^\d+[A-Za-z-]*\s+\S/.test(address) && !/\b(placeholder|example|tbd)\b/i.test(address);
  const streetAddress = address.replace(/,?\s+Chicago\b[\s\S]*$/i, "").trim().replace(/,$/, "");
  const postalCode = address.match(/\b(606\d{2}(?:-\d{4})?)\b/)?.[1];
  return {
    "@type": "AutomotiveBusiness",
    "@id": businessId(origin),
    name: business.name,
    url: absolute(origin, "/"),
    description: SEO_DESCRIPTION,
    logo: absolute(origin, business.logo_url || "/brand/west-loop-ceramics-mark.svg"),
    image: absolute(origin, "/brand/social-preview.jpg"),
    areaServed: business.service_area || "Chicago, Illinois",
    openingHoursSpecification: openingHoursSpecification(business),
    sameAs: [business.instagram_url, business.google_review_url].filter((url) => /^https:\/\//.test(url)),
    ...(business.phone ? { telephone: business.phone } : {}),
    ...(business.email ? { email: business.email } : {}),
    ...(hasStreetAddress ? { address: {
      "@type": "PostalAddress",
      streetAddress,
      addressLocality: "Chicago",
      addressRegion: "IL",
      addressCountry: "US",
      ...(postalCode ? { postalCode } : {}),
    } } : {}),
  };
}

export function websiteSchema(origin: string, businessName: string): SchemaNode {
  return {
    "@type": "WebSite",
    "@id": websiteId(origin),
    url: absolute(origin, "/"),
    name: businessName,
    inLanguage: "en-US",
    publisher: { "@id": businessId(origin) },
  };
}

export function webPageSchema(origin: string, path: string, name: string, description: string, type = "WebPage"): SchemaNode {
  return {
    "@type": type,
    "@id": absolute(origin, `${path}#webpage`),
    url: absolute(origin, path),
    name,
    description,
    inLanguage: "en-US",
    isPartOf: { "@id": websiteId(origin) },
    about: { "@id": businessId(origin) },
  };
}

export function breadcrumbSchema(origin: string, items: Array<{ name: string; path: string }>): SchemaNode {
  const lastPath = items.at(-1)?.path || "/";
  return {
    "@type": "BreadcrumbList",
    "@id": absolute(origin, `${lastPath}#breadcrumbs`),
    itemListElement: [{ name: "Home", path: "/" }, ...items].map((item, index) => ({
      "@type": "ListItem", position: index + 1, name: item.name, item: absolute(origin, item.path),
    })),
  };
}

export function serviceSchema(origin: string, service: Service, description: string, image: string): SchemaNode {
  const path = `/services/${service.slug}`;
  const price = service.price_cents / 100;
  return {
    "@type": "Service",
    "@id": absolute(origin, `${path}#service`),
    name: service.name,
    serviceType: service.name,
    description,
    url: absolute(origin, path),
    image: absolute(origin, image),
    provider: { "@id": businessId(origin) },
    areaServed: "Chicago, Illinois",
    ...(service.pricing_mode !== "quote" && Number.isFinite(price) && price >= 0 ? {
      offers: {
        "@type": "Offer",
        url: absolute(origin, path),
        priceCurrency: "USD",
        description: service.pricing_mode === "starting"
          ? "Starting price for a sedan. Vehicle size, condition, and the agreed scope determine the final quote."
          : "Listed sedan service price. Vehicle size and agreed additional work may change the total.",
        ...(service.pricing_mode === "fixed" ? { price } : {
          priceSpecification: { "@type": "PriceSpecification", minPrice: price, priceCurrency: "USD" },
        }),
      },
    } : {}),
  };
}

/** Questions are shared with the visible page; no hidden claims or FAQ-only content. */
export function faqSchema(origin: string, path: string, questions: Question[]): SchemaNode {
  return {
    "@type": "FAQPage",
    "@id": absolute(origin, `${path}#faq`),
    isPartOf: { "@id": absolute(origin, `${path}#webpage`) },
    mainEntity: questions.map(({ question, answer }) => ({
      "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}
