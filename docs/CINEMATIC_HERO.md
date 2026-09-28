# West Loop Ceramics cinematic Porsche hero

## Experience

The homepage presents one Porsche 911 in a normal-height cinematic hero. The
muted film starts automatically when the hero is visible, turns through the
wash and rinse, and holds its polished final frame. The simplified layout has
one playback control, with no stage-selection buttons or signature strip.
The stationary headline is followed by **Book an appointment** (`/booking`)
and **View services & pricing** (`/services`).

During normal video playback, visitors can pause, resume, or explicitly replay
the film. Replay fades in over the matching clean still; there is no automatic
clean-to-dirty jump. Leaving the viewport or hiding the tab pauses the native
video. Returning resumes only if the visitor has not manually paused or
finished it.

When video autoplay is denied, fails, or never starts within the bounded initial
wait, the hero automatically loads a one-pass animated WebP of the same film.
Its control says **Stop animation**, which ends the animation and reveals the
matching clean still. An animated image cannot be paused at its current frame:
leaving the viewport or hiding the tab also ends it. Returning does not restart
it; **Replay film** is an explicit action. The fallback improves coverage of
video-autoplay restrictions but is not a universal bypass: browser or operating
system settings can also disable animated images.

The hero has no sticky scene, long scroll section, wheel listeners, or scroll
controlled playhead. Reduced-motion and Save-Data preferences show the clean
still without loading either animation. The still and both CTAs remain usable
without JavaScript.

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
The source crop is 1000×440. The quality refresh presents it at 2000×880 on desktop
and 1000×440 on mobile, both 24fps and approximately 8.46 seconds.

The current West Loop Ceramics version uses a deterministic neutral-graphite
color grade of this same generated film, not a new Higgsfield generation. The
original green film is retained. The grade is
`hue=s=0.12,eq=contrast=1.045:brightness=0.006:gamma=1.025` applied after the original
six-frame trim and studio crop. Current files are `porsche-graphite-hq.mp4`,
`porsche-graphite-hq-mobile.mp4`, `porsche-graphite-hq-dirty.webp` and
`porsche-graphite-hq-clean.webp`. Both are encoded directly from the original
1280×720 Higgsfield source, avoiding another encode of an already compressed
web file. A restrained luma sharpen (`unsharp=5:5:0.65:3:3:0`) follows the grade;
desktop then uses `scale=2000:880:flags=lanczos`. This improves edge clarity and
resampling; the upscale does not create new source detail.

The H.264 High level 4.1 encodes use four references, a 24-frame keyframe interval,
CRF 19 desktop / 18 mobile, yuv420p, a 24000 track timescale, and fast-start headers.
Their 203 frames run for 8.458333 seconds. High-quality WebP stills (quality 95)
are extracted from the exact desktop encode's first and final frames. They are
served without Next/Image recompression so the static/replay fallback retains
the same crisp finish. The final video frame remains visible above the poster.

The on-demand fallback, `porsche-autoplay-fallback.webp`, is converted from the
existing high-quality mobile encode without changing its crop or graphite grade.
It is 800×352 at 18fps, with 153 animation frames, a total RIFF duration of
8,499ms, and loop count 1. FFmpeg's `libwebp_anim` encoder uses quality 85 and
compression level 6; the final file is exactly 1,954,660 bytes. Resampling rounds
the source duration slightly, while retaining its exact final source frame.
Decoded opening, wash and final frames were visually checked for whole-car
framing and matching color. The primary MP4 files remain the preferred media.

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
  heading, booking/services CTAs, and one playback control. It chooses native
  video first and starts the image fallback on a policy rejection, media failure,
  or initial startup timeout. Reduced-motion/Save-Data skip both motion paths.
- `hero-video.ts`: dynamically loaded native playback controller. It configures
  `muted`, `defaultMuted`, `autoplay`, and inline playback before assigning the
  source, including the `autoplay`, `muted`, `playsinline`, and
  `webkit-playsinline` attributes. Valid `loadedmetadata` is sufficient to
  initialize playback; `loadeddata`/`canplay` can retry interrupted startup
  without duplicating an in-flight request. Readiness retries are bounded, and
  stale play promises cannot override hidden, manually paused, finished, or
  disposed states. The native film plays once and holds its final frame.
- `hero-animation.ts`: fetches the fallback only when needed, then caches that
  Blob for the controller's lifetime. Each explicit replay creates a fresh
  object URL and image so decoding restarts without another download. Finishing,
  stopping, or leaving the visible page removes the image and exposes the clean
  poster. It does not promise image pause/resume. Disposal aborts requests,
  clears timers, revokes object URLs, and ignores late callbacks.
- `hero-media.ts`: same-origin desktop/mobile MP4 and poster manifest, plus the
  animation path and its measured duration. New reviewed media can replace paths
  without changes to the component. `null` shows the existing clean studio
  still. Never configure missing assets.
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

The film initializes when the hero intersects the viewport and the document is
visible. A 10-second initial watchdog covers Safari cases where `play()` remains
pending instead of rejecting. It runs only during an active initial attempt,
clears once playback begins, and does not restart a film the visitor paused.
The fallback has a 25-second module/download bound and its image decoder has
a 10-second bound. If fallback loading or decoding fails, the clean still stays
visible with a **Retry film** control. No Three.js runtime is loaded by this
hero. Unmounting removes media listeners, observers, timeouts, video sources and
fallback object URLs. Normal page scrolling is unmodified.

## Verification

Run `pnpm typecheck`,
`pnpm exec tsx --test tests/hero-video.test.ts tests/hero-animation.test.ts`, and
`pnpm build`. The 36 targeted unit tests pass. They cover native visibility and
manual-pause behavior, metadata-only startup, bounded readiness retries, stale
play promises, held finish/replay, fallback loading and cancellation, image
stop/replay, fresh object URLs, and failure cleanup. The production `pnpm build`
also passes, including TypeScript validation.

Local verification through the supported computer-use browser UI confirmed
actual native playback, a simulated blocked-autoplay path that automatically
uses the animated fallback, the mobile layout, and fallback stop/replay. These
checks do not establish physical iPhone behavior: a physical iPhone has not been
tested. The existing `test:hero` script contains historical selectors and has
not been validated against this simplified UI; it is not evidence of a current
browser pass.

For further browser checks, inspect desktop/mobile automatic playback,
whole-car framing, native pause/resume, explicit replay, readable CTAs and no
horizontal overflow. Check that leaving the page ends the image fallback rather
than claiming it pauses, and that reduced-motion/Save-Data retain the clean
still. Do not create production bookings or send notifications to test this
visual change.

The current full suite reports 50 passed and 12 failed out of 62 tests. The
platform booking path raises `This service is no longer available`, causing
downstream failures. An isolated archive of upstream commit
`bc32ae75a8f365b63d9716ab46026cf34f854681` reproduces the same platform result:
5 passed and 12 failed. These failures predate this autoplay update; no
business-workflow fix is included in this visual change.
