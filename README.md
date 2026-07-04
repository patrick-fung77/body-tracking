# Anatomy Mirror — webcam pose → 3D body

Real-time tracking of human anatomy: a web app that reads your body pose from
the webcam (MediaPipe Pose) and drives a 3D human figure that mirrors your
movements. Orbit the camera freely and toggle skin / muscle / skeleton layers.
Illustrative accuracy only — not medical grade. Everything runs on-device in
the browser: no servers, no uploaded video.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL (camera requires localhost or HTTPS), allow camera access,
and step back so your full body is in frame.

- **Orbit** the 3D camera with the mouse (drag / scroll) — independent of tracking.
- **Layers** panel toggles skin / muscle / skeleton on the anatomy model.
- **Model** switcher swaps the anatomy for the debug stick figure
  (blue = your left, orange = your right).
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

The current "anatomy" is **placeholder colored primitives** per rigid segment —
concentric skeleton/muscle/skin shells per bone — proving the full pipeline.

**TODO(asset):** swap in a real anatomy GLB. The intended source, Z-Anatomy
(BodyParts3D-derived), ships as many separate anatomically-named meshes with
**no humanoid armature or skin weights**. The integration plan: group its
meshes into the same rigid segments defined in `rig/skeleton.ts` (one parent
`Object3D` per bone, origin at the proximal joint, +Y toward the distal joint)
and `AnatomySegments`' driving logic applies unchanged. The mesh
grouping/naming needs to be decided together once the GLB is inspected — no
asset was bundled in this repo yet.
