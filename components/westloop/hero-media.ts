export type HeroVideoSource = {
  /** Same-origin, seekable H.264 MP4, encoded with frequent keyframes. */
  src: string;
  /** First and final frames from this exact clip. */
  poster: string;
  cleanPoster: string;
};

export type HeroVideoMedia = {
  desktop: HeroVideoSource;
  /** Optional smaller encode. Keep the whole car in a landscape composition. */
  mobile?: HeroVideoSource;
  description?: string;
};

// Enable only after the finished film and its matching stills exist in public/hero.
// A null value keeps the existing interactive 3D experience and its stills.
export const heroVideoMedia: HeroVideoMedia | null = {
  desktop: {
    src: "/hero/porsche-transform.mp4",
    poster: "/hero/porsche-dirty.webp",
    cleanPoster: "/hero/porsche-clean.webp",
  },
  mobile: {
    src: "/hero/porsche-transform-mobile.mp4",
    poster: "/hero/porsche-dirty.webp",
    cleanPoster: "/hero/porsche-clean.webp",
  },
  description: "A Porsche 911 rotates through a complete turn, from road-worn paint through a wash to a polished finish as you scroll",
};
