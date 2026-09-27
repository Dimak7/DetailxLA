# West Loop Ceramics refresh

The public site uses a warm ivory, graphite and copper palette, a custom layered-C
logo and a ceramic-coating-first service hierarchy. Existing service prices,
durations, inclusions, IDs and business contact settings remain the data source.
Legacy default business names resolve to West Loop Ceramics at read time; custom
business names and stored settings are preserved. No production data migration
or reset is required.

Eight existing service routes now have distinct fit, process, preparation and FAQ
content. Calls to action preserve the service ID through the booking wizard.
Booking links also accept a service slug. The home service finder recommends
only services present in the published catalogue.

## Future ceramic-coating footage

The homepage and ceramic-coating detail share `components/westloop/CeramicFilm.tsx`.
`lib/site-media.ts` intentionally sets `ceramicFilm` to `null`. Until approved
footage is available the section shows a clearly described process illustration,
without an inactive play control. To add the business's film:

1. Place an optimized MP4/WebM in `public`, or use an approved HTTPS media URL.
2. Set `ceramicFilm` to `{ src: "/media/ceramic-process.mp4" }`.
3. If there is speech, add an English WebVTT file and set `captions` to its URL.
4. Replace `ceramicFilmPoster` with an actual frame from that film if appropriate.

The player uses native controls, inline playback and `preload="none"`.

## Media provenance

The graphite Porsche hero is a deterministic color grade of the existing
Higgsfield Genjutsu film, not a new video generation. The final crop keeps the
entire Porsche in frame. It plays automatically when visible, pauses offscreen,
and holds the finished frame with an explicit replay control. Reduced-motion and
data-saving preferences receive the clean poster. Details are in
`docs/CINEMATIC_HERO.md` and public attribution in `public/hero/credits.txt`.

The ceramic application still was generated for this refresh using the built-in
image generator, then resized to a 1600×900 WebP. Prompt: Photorealistic wide 16:9
premium automotive editorial macro; a black nitrile-gloved hand using a charcoal
suede applicator on metallic graphite-silver Porsche 911 paint; natural softbox
reflection, visible metallic flakes and shallow depth of field; subtle copper
edge reflection in a neutral studio; no text, watermark, logos or faces. It is
labelled as an illustration on both public pages where it appears.

## Editorial references

Coating copy describes easier washing, water repellency and the importance of
preparation and maintenance. It does not claim scratch-proofing, stone-chip
protection, a specific lifespan, certification or a product warranty. Supporting
manufacturer references, without implying an affiliation or product selection:

- https://gtechniq.com/ceramiccoatings/
- https://gtechniq.com/protecting-car-paint-tips/
- https://gtechniq.com/how-to-wash-a-ceramic-coated-car/

## Validation

- `node --import tsx --test tests/hero-video.test.ts`: 9/9 passed.
- `pnpm typecheck` and `pnpm build`: passed.
- Browser review at 1440×1000, 390×844 and 320×740: new brand, whole-car framing,
  desktop/mobile sources, automatic playback, final-frame hold, replay and pause;
  mobile menu, service filter, inclusions and FAQ disclosures; no horizontal
  overflow on checked pages.
- The service finder selected paint correction and carried its ID into booking.
  The booking wizard reached available times and final appointment review using
  a local in-memory database. No appointment was submitted.
- HTTP smoke: all eight service pages and the service index returned 200, one H1,
  expected prices, branded titles and canonical paths. All eight UUID booking
  links resolved to their intended service; an unknown service returned 404.
- The standalone browser smoke script was updated and syntax checked, but was
  not run; browser verification used the supported CUA interface.

The full pre-existing PGlite integration suite has unrelated failures and is not
represented as passing by this refresh. Local tracking POSTs were rejected by
the existing configured-origin protection because preview ran on port 3107;
that protection was preserved.
