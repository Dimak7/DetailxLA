# West Loop Auto Spa Porsche scroll hero

## Experience

The homepage follows one Porsche 911 GT3 from road grime to a polished finish.
Native page scrolling controls a paused film through arrival, a horizontal
360-degree rotation, wash/rinse and the final reveal. Scrolling upward reverses
the same sequence. No autoplay, sound, wheel interception or scroll hijacking.

The video is an AI detailing visualization, not footage of a customer's car.
Porsche is the depicted vehicle make, not an affiliation or endorsement.

## Media and provenance

The clean Porsche appearance reference was created with the built-in image
generation tool. Higgsfield Genjutsu object replacement uses that reference and
a deterministic 9-second Three.js motion guide rendered from the previously
licensed model. The guide is not the final Porsche asset. The original model's
attribution is retained in `public/hero/credits.txt`.

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

- `CinematicHero.tsx`: native scroll progress, chapter text, CTAs and lifecycle.
- `hero-video.ts`: dynamically loaded paused-video renderer. One seek is allowed
  at a time, and `seeked` consumes only the latest requested progress. Abort,
  decode failure and stalled seeks clean up the video and restore its still.
- `hero-media.ts`: explicit same-origin desktop/mobile MP4 and poster manifest.
  `null` preserves the former Three.js experience if the film is unavailable
  during development. Never point it at missing or unreviewed files.
- `CinematicHero.module.css`: isolated styles, contained car framing, mobile
  layout, visible focus states and contrasting CTAs.

Encode H.264, yuv420p, silent, fast-start, with a six-frame keyframe interval for
seeking. The mobile variant uses the same complete composition at lower resolution;
it must not crop off wheels or bumpers. Derive first/final stills from this exact
film. Asset requests are same-origin and require no runtime Higgsfield credentials.

Reduced-motion, Save-Data, low-memory devices and decoder failures display the
matching clean still. Without JavaScript, the poster and booking links remain
available. The film loads only when the hero approaches the viewport. No 3D
runtime is loaded when the video is configured. Unmounting removes listeners,
observers, animation frames, timeouts and the video source.

## Verification

Use `pnpm typecheck`, `pnpm exec tsx --test tests/hero-video.test.ts` and
`pnpm build`. The focused tests cover seek coalescing, reversal, endpoints and
cancellation/failure cleanup. `pnpm test:hero` is the optional Chrome smoke
script; run against an isolated preview with `PGLITE_PATH=memory://hero-preview`
and `HERO_TEST_URL=http://localhost:3107`.

Inspect actual desktop and mobile rendering at start, 25%, 50%, 75%, finish and
backward scroll. Check the whole Porsche stays visible, video is paused,
progress agrees with the playhead, CTAs work, no horizontal overflow occurs,
and fallbacks retain the same vehicle. Do not create production bookings or
send notifications to test this visual change.

Baseline before these changes: TypeScript passed; the full business integration
suite had 12/22 passing with PGlite booking errors on this machine. Those failures
predate this hero change; do not report them as passing without a new result.

The production build, TypeScript check and six focused video-renderer tests pass.
In-browser inspection at 1440×900 and
390×844 confirms paused forward/reverse seeking, the matching mobile source, no
horizontal overflow, and working navigation from the hero to the booking page.
The final media and posters are also inspected independently across the full turn.
