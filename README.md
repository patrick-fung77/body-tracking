# Anatomy Mirror — webcam pose → 3D body

Real-time tracking of human anatomy: a web app that reads your body pose from
the webcam (MediaPipe Pose) and drives a rigged 3D skeleton that mirrors your
movements. Orbit the camera freely; alternate views include a layered
skin/muscle/skeleton primitive model and a debug stick figure. Illustrative
accuracy only — not medical grade. Everything runs on-device in the browser:
no servers, no uploaded video.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL (camera requires localhost or HTTPS), allow camera access,
and step back so your full body is in frame.

- **Orbit** the 3D camera with the mouse (drag / scroll) — independent of tracking.
- **Model** switcher: realistic rigged skeleton (default), pink cartoon
  character, mecha warrior, layered anatomy primitives, or the debug stick
  figure (blue = your left, orange = your right).
- **Import GLB model…** loads any humanoid-rigged GLB from your device — the
  skeleton is auto-detected, no code changes needed. Files never leave the
  browser and last for the current session only.
- **Layers** panel toggles skin / muscle / skeleton on the *anatomy primitives*
  model (the realistic model is skeleton-only, so layers don't apply to it).
- **Mirror mode** flips X so the model moves like a mirror image.
- **Axis helper** shows the rig's coordinate frame for debugging.
- Pose inference FPS is in the panel; render FPS is the stats widget (top-left).

The MediaPipe wasm and the `pose_landmarker_full` model load from CDNs by
default. For offline dev, put local copies under `public/` and point
`VITE_MEDIAPIPE_WASM` / `VITE_MEDIAPIPE_MODEL` at them in `.env.local`
(the wasm ships inside `node_modules/@mediapipe/tasks-vision/wasm`). If the
frame rate is bad on your machine, swap the model URL's `full` for `lite`.

## How it works

```
src/
  pose/usePoseTracker.ts   getUserMedia + PoseLandmarker (VIDEO mode) loop
  pose/poseStore.ts        mutable latest-result store (decouples infer/render)
  overlay/PoseOverlay2D.tsx  Phase 1: landmarks drawn over the live video (PiP)
  rig/skeleton.ts          bone definitions (landmark pairs per bone)
  rig/retarget.ts          world landmarks → smoothed per-bone quaternions
  rig/StickFigure.tsx      Phase 2: cylinder rig
  rig/AnatomySegments.tsx  Phase 3: rigid layered segments (skin/muscle/bone)
  rig/RigModel.tsx         Phase 3+: rigged GLB models driven via their armatures
  rig/autoRig.ts           humanoid joint auto-detection (names + structure)
  scene/Scene3D.tsx        Phase 4: lights, ground, OrbitControls, stats
  ui/HUD.tsx               toggles, FPS, status messages
```

- **Decoupling:** the inference loop writes the latest result into `poseStore`;
  the 2D overlay and the r3f render loop poll it from their own rAF loops. A
  dropped/slow pose frame never stalls rendering — the model just holds its
  last smoothed pose.
- **Retargeting:** uses `result.worldLandmarks` (meters, hip-origin). For each
  bone (e.g. left shoulder → left elbow) a quaternion rotates the rest
  direction (+Y) onto the measured direction; landmarks are exponentially
  smoothed and bones slerp toward their targets, so nothing vibrates.
- **Coordinates:** MediaPipe's world frame is X-right/Y-down/Z-away; negating
  Y and Z maps it onto Three.js (Y-up, Z-toward-viewer). All sign flips live in
  one function (`toThree` in `rig/retarget.ts`) if something ever looks flipped.

## Known limitations (intentional MVP scope)

- **Rigid segments:** limbs rotate at the joints; there is no skin/muscle
  deformation across joints. Proper smooth deformation needs a Blender armature
  + weight painting — a future upgrade, out of scope here.
- **No bone twist:** roll about a bone's own axis (forearm pronation, head
  yaw) is not recoverable from point landmarks and is not attempted.
- **No hands/fingers**, feet are simple wedges, and the figure stands at a
  fixed hip height (it doesn't ground-clamp when you crouch).

## Model asset status (Phase 3)

Rigged GLB models are driven through their armatures by `rig/RigModel.tsx`,
which binds retargeted bone directions onto armature joints (hip and chest
get two-axis lateral+up alignment so body yaw and lean come through;
limbs/head/feet are single-axis). Joints are discovered automatically by
`rig/autoRig.ts`: it anchors on reliably-named bones (forearm/shin/hand/
foot/neck/head across DAZ, Blender/Rigify, Mixamo, Unreal, and Auto-Rig-Pro
conventions), derives the rest structurally (upper arm = nearest
distinctly-positioned ancestor of the forearm, hip = common ancestor of the
thighs, chest = common ancestor of the upper arms), excludes twist/IK/
control helpers, and infers facing from the hip axis. Adding a model —
including user imports at runtime — therefore needs no per-model code.
Bundled models:

- `female_skeleton.glb` — rigged, skinned skeleton (Sketchfab export,
  118 joints, 14 skinned meshes, ~40k verts). Default view.
- `pink-character.glb` — Blender cartoon character (FK bones: pelvis/spine/
  chest/neck/head + limbs; the CTRL_* IK helpers are ignored, and its feet
  have no toe joint so they stay rigid relative to the shins).
- `mecha_warrior.glb` — "BOT MECHA WARRIOR 3D" by Oscar Creativo
  (Sketchfab). Auto-Rig-Pro-style rig; the stretch chain is driven, twist
  and finger bones follow rigidly. The source asset was 50 MB and is served
  Draco+WebP compressed (~6 MB); the Draco decoder is bundled under
  `public/draco/` so no CDN is involved. Recompress future large models
  with: `npx @gltf-transform/cli optimize in.glb out.glb --compress draco
  --texture-compress webp --texture-size 1024`.

**Attribution:** "BOT MECHA WARRIOR 3D" by Oscar Creativo (Sketchfab). For
the skeleton and any other downloaded models, check their source pages for
license terms (most Sketchfab assets are CC-BY and require crediting the
author) and record the credits here.

The "Anatomy (layers)" view keeps the earlier **placeholder colored
primitives** — concentric skeleton/muscle/skin shells per rigid segment —
since the realistic model has no muscle or skin meshes. A future
muscles+skin anatomy asset (e.g. Z-Anatomy, which ships as many separate
named meshes with no armature) could either be grouped into the rigid
segments of `rig/skeleton.ts` or, better, rigged to this same armature in
Blender.
