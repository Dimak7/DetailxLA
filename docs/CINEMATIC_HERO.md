# West Loop Auto Spa cinematic hero

## Production implementation

The homepage uses a single Three.js vehicle and scroll-controlled materials.
No autoplay video, external embed, scroll hijacking, or generated frame changes.
The model rotates 360 degrees; surface grime dissolves behind a moving wash line.
Paint clearcoat, glass, wheel roughness, studio reflections and mist follow the same progress.
Native links remain available before JavaScript or WebGL loads.

## Higgsfield generation brief (not submitted)

Higgsfield is installed, but its generation actions were not exposed in this session.
These are production prompts for a future optional scroll-video replacement. Use a
single reference vehicle and continuous take, never four independently generated cars.

Master: Photorealistic automotive commercial, one dark forest-green luxury sports
car, silver multi-spoke wheels, realistic proportions. Minimal charcoal studio,
wide softbox reflections, quiet warm rim light, ground contact shadow. Car centered,
locked focal length and distance. No lettering, people, logos, camera cuts, drifting,
wheel deformation, exaggerated foam, or impossible body movement. Preserve the exact
vehicle, wheels, glass, panel geometry and studio across every frame. This is a visual
illustration of detailing, not evidence of completed customer work.

1. Dirty / 0-20%: front three-quarter angle, visible beige road grime on lower panels,
   brake dust on wheels, dried water spots and dull dusty glass. Vehicle stationary.
2. Detail / 20-50%: smoothly rotate on its center toward 180 degrees. A soft fan of
   water and fine mist removes grime progressively, panel by panel. Camera stays fixed.
3. Clean / 50-75%: continue the same rotation. Remaining grime clears from wheels and
   glass; forest-green paint reveals sharp, believable softbox reflections.
4. Showroom / 75-100%: finish one 360-degree turn at the original angle. Deep glossy
   paint, clean spokes, clear glass, restrained water beading. Settle without looping.

Recommended video: desktop 1920x1080, mobile 1080x1350 independently reframed from
the SAME take; 6-8 seconds, 24fps, H.264 MP4, no audio, fast-start, short keyframe
interval (6-12 frames) for seeking. Target <4MB desktop / <2MB mobile. If used later,
map scroll to currentTime, do not autoplay. Keep the current 3D implementation until
an actual consistent video has been generated and inspected.

## Assets and performance

- `public/hero/detail-car.glb`: 1.7MB Draco-compressed model, hosted locally.
- `public/hero/draco/`: local WASM decoder; no CDN at runtime.
- `public/hero/poster*.webp`: dirty/clean renders of the same model; mobile-specific framing.
- `components/westloop/CinematicHero.tsx`: progressive loading, scroll and pointer events.
- `components/westloop/hero-scene.ts`: lazy Three.js scene and resource cleanup.
- `components/westloop/CinematicHero.module.css`: isolated mobile/desktop styles.

Rendering happens only on scroll/pointer/resize while visible. DPR is capped at
1.25 on small screens, 1.75 on desktop. Reduced motion, Save-Data and low-memory
devices use the static view. No required
booking control depends on canvas. Context loss and loading errors restore the poster.

## Verification

Check forward/reverse scroll at 0, 25, 50, 75 and 100%; verify same car and centered
rotation. Check 1440px and 390px, short landscape, reduced motion, JS disabled,
model request failure and canvas context loss. Check keyboard CTAs, no horizontal
overflow, no shader/console errors and disposal when navigating away.

Run the local server on port 3107, then `pnpm test:hero` (Chrome required).
`HERO_TEST_URL` can select another server. The script writes captures and results to
the ignored `artifacts/hero/` directory. For isolated local verification, start the
server with `PGLITE_PATH=memory://hero-preview`. The browser checks do not submit
appointments or send customer notifications.

Verified locally: forward/reverse desktop and mobile rendering, context loss,
three fallback modes and booking navigation, 32 button/link contrast checks
across five public pages (minimum 4.5:1), and 320px / landscape layouts.
All 22 existing business integration tests pass. Actual-device GPU performance
still depends on hardware; the automated visual checks use Chrome emulation.
