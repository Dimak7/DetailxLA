"use client";
import Image from "next/image";
import { useState } from "react";
import type { GalleryItem } from "@/lib/platform/types";
function Comparison({ item }: { item: GalleryItem }) {
  const [value, setValue] = useState(50);
  return (
    <figure className="comparison">
      <div className="comparison-images">
        <Image
          src={item.image_url}
          alt={item.title + " after"}
          fill
          sizes="(max-width:768px) 100vw, 50vw"
        />
        <div
          className="before-layer"
          style={{ clipPath: "inset(0 " + (100 - value) + "% 0 0)" }}
        >
          <Image
            src={item.before_url}
            alt={item.title + " before"}
            fill
            sizes="(max-width:768px) 100vw, 50vw"
          />
        </div>
        <span className="comparison-line" style={{ left: value + "%" }} />
        <span className="before-label">Before</span>
        <span className="after-label">After</span>
        <input
          aria-label={"Compare before and after: " + item.title}
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
        />
      </div>
      <figcaption>
        {item.title}
        <small>{item.caption}</small>
      </figcaption>
    </figure>
  );
}
export function Gallery({ items }: { items: GalleryItem[] }) {
  const [category, setCategory] = useState("All");
  return (
    <>
      {items.length > 0 && (
        <div className="filter-row">
          {["All", ...new Set(items.map((i) => i.category))].map((c) => (
            <button
              key={c}
              className={c === category ? "active" : ""}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="gallery-grid">
        {items
          .filter((i) => category === "All" || i.category === category)
          .map((i) =>
            i.before_url ? (
              <Comparison key={i.id} item={i} />
            ) : (
              <figure key={i.id}>
                <div className="gallery-image">
                  <Image
                    src={i.image_url}
                    alt={i.title}
                    fill
                    sizes="(max-width:768px) 100vw, 50vw"
                  />
                </div>
                <figcaption>
                  {i.title}
                  <small>{i.caption}</small>
                </figcaption>
              </figure>
            ),
          )}
      </div>
      {!items.length && (
        <div className="empty-public">
          <p className="eyebrow">THE WORK, UP CLOSE</p>
          <h3>Every finish has a story.</h3>
          <p>
            Our client gallery is coming soon. Ask us about the right finish for
            your vehicle.
          </p>
        </div>
      )}
    </>
  );
}
