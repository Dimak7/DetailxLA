# West Loop Ceramics cinematic Porsche hero

## Experience

The homepage presents one Porsche 911 in a normal-height cinematic hero. The
muted film starts automatically when the hero is visible, turns through the
wash and rinse, and holds its polished final frame. Visitors can pause, resume,
or explicitly replay the film. Replay fades in over the matching clean still;
there is no automatic clean-to-dirty jump. The headline and ceramic-coating and
booking links remain stationary and readable throughout.

The hero has no sticky scene, long scroll section, wheel listeners, or scroll
controlled playhead. Leaving the viewport or hiding the tab pauses playback.
Returning resumes only if the visitor has not manually paused or finished the
film. When a browser blocks autoplay, the visible Play film button recovers
playback through a direct user gesture.

The video is an AI detailing visualization, not footage of a customer's car.
Porsche is the depicted vehicle make, not an affiliation or endorsement.

## Media and provenance

The clean Porsche appearance reference was created with the built-in image
generation tool. Higgsfield Genjutsu object replacement uses that reference and
a deterministic 9-second Three.js motion guide rendered from the previously
licensed model. The guide is not the final Porsche asset. The original model's
attribution is retained in `public/hero/credits.txt`, accessible through the
footer's Visual credits link. The hero keeps only its film playback control.

- Higgsfield project: `8d981144-7e99-486f-a5a3-636084081a91`
- Porsche reference media: `a9fceb9e-442e-4771-b421-6447a2a83ca3`
- Motion guide media: `1e32b4ff-cb95-45ab-bdab-16889cffddc0`
- Video generation job: `7b039c68-c42b-421e-a32f-e6e13c30f26e`
- Model: `hf_mult_replace_object`, one user-authorized free run at 720p.

Generation status: completed and visually reviewed. The finished film and its
matching posters are installed under `public/hero/` and enabled in
`components/westloop/hero-media.ts`. A fixed studio crop removes empty margins;
the first six frames are trimmed to keep the whole Porsche visible on entry.
Desktop is 1000×440 and mobile is 900×396, both 24fps and approximately 8.46 seconds.

The current West Loop Ceramics version uses a deterministic neutral-graphite
color grade of this same generated film, not a new Higgsfield generation. The
original green film is retained. The grade is
`hue=s=0.12,eq=contrast=1.045:brightness=0.006:gamma=1.025` applied after the original
six-frame trim and studio crop. Current files are `porsche-graphite.mp4`,
`porsche-graphite-mobile.mp4`, `porsche-graphite-dirty.webp` and
`porsche-graphite-clean.webp`. The encodes use a 24-frame keyframe interval and
CRF 20 desktop / 23 mobile for automatic playback. Their 203 frames run for
8.458333 seconds. The matching stills are extracted from the graded film.

### Reference image prompt

Photorealistic 16:9 automotive studio photograph of one dark forest-green
Porsche 911 GT3 (992), characteristic oval headlights, closed coupe roof,
fixed rear wing, silver center-lock multi-spoke wheels and yellow calipers.
Entire vehicle, front-left three-quarter view, centered, dark charcoal-green
seamless studio, warm softbox highlights, cool rim light, natural tire contact
shadow. Clean polished paint and glass. No people, extra cars, lettering or
watermarks. Built-in generated original is retained in the local artifact
folder; the deployed fallbacks are taken from the finished film.

### Higgsfield prompt

Replace only the sports car in the driving video with the exact dark forest-green Porsche 911 GT3 (992) from the reference image. This is a premium West Loop Auto Spa automotive-detailing website hero. Preserve the driving video's centered composition, continuous single take, smooth car arrival, full 360-degree horizontal turntable rotation and dirty-to-clean transformation timing. Keep recognizable Porsche 911 round oval headlights, coupe roof, fixed GT3 rear wing, silver center-lock multi-spoke wheels and yellow brake calipers consistently through all angles. At the start this same Porsche is covered in realistic beige road grime, dusty glass and dirty wheels. During the rotation a controlled detailing wash progressively strips the dirt: fine white foam, translucent water spray and restrained mist, revealing immaculate deep green metallic paint, clear glass and polished wheels by the final front three-quarter view. Grounded tires and physically plausible studio lighting, warm softbox highlights on dark charcoal-green seamless backdrop, natural floor shadow. Exact same Porsche all the way through, no camera cuts, no people, no added lettering, no new objects, no sudden jumps, no warped geometry or wheel changes, no vertical somersault. Photorealistic premium automotive commercial. Final second holds the clean finished car. Silent output intended for smooth forward and reverse scroll scrubbing.

Replace the entire Ferrari convertible guide with the closed-roof Porsche GT3,
including roof, rear wing, headlights and wheels; remove Ferrari branding.

## Implementation

- `CinematicHero.tsx`: visibility and motion preferences, stable marketing
  heading, coating and booking CTAs, playback control and process progress.
- `hero-video.ts`: dynamically loaded playback controller. Plays once, reports
  media time, pauses offscreen, preserves manual pause, handles blocked autoplay,
  and holds the last frame for an explicit replay. A stale play promise cannot
  restart a hidden or disposed film. Decode failure and stalled playback restore
  the clean still.
- `hero-media.ts`: same-origin desktop/mobile MP4 and poster manifest. New
  reviewed media can replace paths without changes to the component. `null`
  shows the existing clean studio still. Never configure missing assets.
- `CinematicHero.module.css`: graphite studio, ivory typography, pale-gold and
  copper accents, full-car framing, mobile layout and visible focus indicators.

The poster and film share an intrinsic 25:11 frame fitted inside the available
hero area. A combined horizontal and vertical alpha mask blends all four edges
into the uniform hero background. Applying this mask to the actual media frame,
rather than its letterboxed video element, prevents exposed rectangular borders
at tablet widths and tall viewports. This is a presentation blend; the original
generated film remains intact. Decorative arrows have been removed from links
and buttons throughout the site at the owner's request.

Encode silent H.264, yuv420p, with a fast-start header. The mobile variant keeps
the same complete composition at lower resolution; do not crop wheels or
bumpers. Derive first/final stills from the exact film. Asset requests are
same-origin and require no runtime Higgsfield credentials.

Reduced-motion, Save-Data and decoder failure display the clean still. Without
JavaScript, the still and service/booking links remain available. The film loads
when at least 15% of the hero enters the viewport, and pauses if the document is
hidden. No Three.js runtime is loaded by this hero. Unmounting removes media
listeners, observers, timeouts and the video source. Normal page scrolling is
unmodified.

## Verification

Run `pnpm typecheck`, `pnpm exec tsx --test tests/hero-video.test.ts` and
`pnpm build`. Focused unit tests cover visibility pause/resume, manual-pause
persistence, the final-frame hold and explicit replay, blocked-autoplay recovery,
stale playback promises, and cancellation/failure cleanup.

Inspect desktop/mobile in the supported browser UI. Check automatic muted
playback, whole-car framing, pause/resume, replay fade, offscreen/tab pause, a
single normal-height section, readable CTAs and no horizontal overflow. Confirm
reduced-motion and media-failure stills retain the same car. Do not create
production bookings or send notifications to test this visual change.

`pnpm test:hero` now exercises the automatic film and new brand selectors. Run
it against an isolated preview with `PGLITE_PATH=memory://hero-preview` and
`HERO_TEST_URL=http://localhost:3107`. It checks the actual desktop/mobile media
sources and dimensions, muted automatic playback, manual pause/resume, native
scroll independence, offscreen pause, held finish/replay, error/retry, blocked
autoplay recovery, reduced-motion/Save-Data/no-JavaScript stills, navigation,
button contrast and compact layouts. Screenshots and a JSON report go into
`artifacts/hero/`. This script has been updated and syntax-checked for the new
experience; do not claim a browser pass until it has actually been executed.
During this implementation, live browser verification uses the supported
computer-use browser UI instead of shell-driven browser automation.

Baseline before the original hero changes: TypeScript passed; the full business
integration suite had 12/22 passing with PGlite booking errors on this machine.
Those failures predate this hero work; do not report them as passing without a
new result. Current build and browser verification must be recorded after the
complete rebrand and final assets are in place.
