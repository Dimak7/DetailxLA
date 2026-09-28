export type HeroVideoSource = {
  /** Same-origin, silent H.264 MP4 with a fast-start header. */
  src: string;
  /** First and final frames from this exact clip. */
  poster: string;
  cleanPoster: string;
};

export type HeroVideoMedia = {
  desktop: HeroVideoSource;
  /** Optional smaller encode. Keep the whole car in a landscape composition. */
  mobile?: HeroVideoSource;
  /** One-pass animated image for browsers that deny video autoplay. */
  animation?: { src: string; durationMs: number };
  description?: string;
};

// Enable only after the finished film and its matching stills exist in public/hero.
// A null value shows the existing clean studio still without animation.
export const heroVideoMedia: HeroVideoMedia | null = {
  desktop: {
    src: "/hero/porsche-graphite-hq.mp4",
    poster: "/hero/porsche-graphite-hq-dirty.webp",
    cleanPoster: "/hero/porsche-graphite-hq-clean.webp",
  },
  mobile: {
    src: "/hero/porsche-graphite-hq-mobile.mp4",
    poster: "/hero/porsche-graphite-hq-dirty.webp",
    cleanPoster: "/hero/porsche-graphite-hq-clean.webp",
  },
  animation: { src: "/hero/porsche-autoplay-fallback.webp", durationMs: 8499 },
  description: "A graphite Porsche 911 rotates through a complete turn, from road-worn paint through a careful wash to a polished finish",
};
