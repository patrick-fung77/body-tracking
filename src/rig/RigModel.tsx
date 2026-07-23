import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  Box3,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  SkinnedMesh,
  Vector3,
} from "three";
import { poseStore } from "../pose/poseStore";
import { detectHumanoidRig, type ResolvedBinding } from "./autoRig";
import type { BonePose, Retargeter } from "./retarget";

/**
 * Drives a rigged GLB character with the retargeted bone poses, through its
 * actual armature joints. The armature is discovered automatically
 * (rig/autoRig.ts) — any humanoid-rigged GLB can be dropped in without
 * per-model code, including user-imported files.
 *
 * Binding strategy: for each detected joint we record, at load time, its
 * rest world orientation and the rest world direction toward a reference
 * child joint (e.g. upper arm → forearm). Each frame the delta rotation
 * that carries the rest direction onto the measured landmark direction is
 * applied on top of the rest orientation, in world space, then converted to
 * the joint's local space (parents are processed first). The hip and chest
 * use a two-axis (lateral + up) alignment so body yaw and lean come through.
 */

/**
 * Height of the rig group above the ground plane (world landmarks are
 * hip-origin). Scene3D positions the rig group at this Y; models compensate
 * for their own leg length inside buildRig so their feet rest on the ground.
 */
export const HIP_HEIGHT = 0.95;

export interface RigModelConfig {
  /** Display name (used in the model dropdown for imports). */
  name: string;
  url: string;
  /** Normalized standing height (m). */
  height: number;
}

/** Sketchfab female skeleton (Poser-style joint names). */
export const FEMALE_SKELETON: RigModelConfig = {
  name: "Skeleton (realistic)",
  url: `${import.meta.env.BASE_URL}models/female_skeleton.glb`,
  height: 1.66,
};

/** Blender cartoon character (its feet have no toe joint → feet stay rigid). */
export const PINK_CHARACTER: RigModelConfig = {
  name: "Pink character",
  url: `${import.meta.env.BASE_URL}models/pink-character.glb`,
  height: 1.6,
};

/**
 * "BOT MECHA WARRIOR 3D" by Oscar Creativo (Sketchfab; Auto-Rig-Pro-style
 * rig). Draco+WebP compressed from 50 MB to ~6 MB.
 */
export const MECHA_WARRIOR: RigModelConfig = {
  name: "Mecha warrior",
  url: `${import.meta.env.BASE_URL}models/mecha_warrior.glb`,
  height: 1.85,
};

/** Default height for user-imported models. */
export const IMPORT_HEIGHT = 1.7;

/** Local Draco decoder so compressed GLBs load without any CDN. */
const DRACO_PATH = `${import.meta.env.BASE_URL}draco/`;

export function RigModel({
  retargeter,
  config,
}: {
  retargeter: Retargeter;
  config: RigModelConfig;
}) {
  const { scene } = useGLTF(config.url, DRACO_PATH);
  const rig = useMemo(() => buildRig(scene, config), [scene, config]);

  useFrame(() => {
    const { worldLandmarks, timestampMs } = poseStore.frame;
    const poses = retargeter.update(worldLandmarks, timestampMs);
    driveRig(rig, poses);
  });

  return <primitive object={rig.wrapper} />;
}

useGLTF.preload(FEMALE_SKELETON.url, DRACO_PATH);
useGLTF.preload(PINK_CHARACTER.url, DRACO_PATH);
useGLTF.preload(MECHA_WARRIOR.url, DRACO_PATH);

/* ------------------------------------------------------------------ */

interface RigEntry {
  joint: Object3D;
  bone: string;
  restDir: Vector3; // world space, captured at rest
  restQuat: Quaternion; // world space, captured at rest
  up?: { bone: string; restDir: Vector3 };
}

interface Rig {
  wrapper: Group;
  entries: RigEntry[];
}

const UP = new Vector3(0, 1, 0);

/**
 * useGLTF caches and returns the same scene object on every mount, and React
 * StrictMode double-invokes useMemo — binding must happen exactly once per
 * scene or the model gets reparented into a wrapper that never mounts.
 */
const rigCache = new WeakMap<Group, Rig>();

function buildRig(scene: Group, config: RigModelConfig): Rig {
  const cached = rigCache.get(scene);
  if (cached) return cached;
  const rig = buildRigUncached(scene, config);
  rigCache.set(scene, rig);
  return rig;
}

function buildRigUncached(scene: Group, config: RigModelConfig): Rig {
  const wrapper = new Group();
  wrapper.add(scene);
  wrapper.updateMatrixWorld(true);

  const detected = detectHumanoidRig(scene);
  if (detected.flipFacing) {
    wrapper.rotation.y = Math.PI;
    wrapper.updateMatrixWorld(true);
  }

  scene.traverse((o) => {
    if (o instanceof Mesh) o.castShadow = true;
    if (o instanceof SkinnedMesh) o.frustumCulled = false;
  });

  // Normalize: uniform scale to the configured height, hips at origin.
  const box = new Box3().setFromObject(scene);
  const height = box.max.y - box.min.y;
  if (height > 1e-3) scene.scale.multiplyScalar(config.height / height);
  wrapper.updateMatrixWorld(true);
  const hipWorld = detected.hip.getWorldPosition(new Vector3());
  scene.position.sub(hipWorld);
  wrapper.updateMatrixWorld(true);

  // Ground the rest pose: the rig group sits at HIP_HEIGHT, but a character
  // with short legs would float there. Shift so the rest-pose soles touch
  // the ground plane instead of pinning hips at human height.
  const grounded = new Box3().setFromObject(scene);
  wrapper.position.y = -HIP_HEIGHT - grounded.min.y;
  wrapper.updateMatrixWorld(true);

  // Re-bind skinned meshes: scaling an ancestor after binding otherwise
  // applies the scale twice through the bone-matrix path (bind matrices and
  // bone inverses were captured pre-scale). Must run while still in rest
  // pose. No-op for models whose meshes are rigidly parented to bones.
  const skeletons = new Set<SkinnedMesh["skeleton"]>();
  scene.traverse((o) => {
    if (o instanceof SkinnedMesh) {
      skeletons.add(o.skeleton);
      o.bind(o.skeleton, o.matrixWorld);
    }
  });
  for (const s of skeletons) s.calculateInverses();

  // Capture rest orientations/directions in (wrapper-relative) world space.
  const worldPos = (o: Object3D) => o.getWorldPosition(new Vector3());
  const restDir = (b: { restFrom: Object3D; restTo: Object3D }) =>
    worldPos(b.restTo).sub(worldPos(b.restFrom)).normalize();
  const entries: RigEntry[] = detected.bindings.map((b: ResolvedBinding) => ({
    joint: b.joint,
    bone: b.bone,
    restDir: restDir(b),
    restQuat: b.joint.getWorldQuaternion(new Quaternion()),
    up: b.up && { bone: b.up.bone, restDir: restDir(b.up) },
  }));

  return { wrapper, entries };
}

const tmpDir = new Vector3();
const tmpUpDir = new Vector3();
const tmpDelta = new Quaternion();
const tmpWorld = new Quaternion();
const tmpParent = new Quaternion();
const mA = new Matrix4();
const mB = new Matrix4();
const ax = new Vector3();
const ay = new Vector3();
const az = new Vector3();

function driveRig(rig: Rig, poses: Map<string, BonePose>): void {
  for (const entry of rig.entries) {
    const pose = poses.get(entry.bone);
    if (!pose?.valid) continue;
    tmpDir.copy(UP).applyQuaternion(pose.quaternion);

    const upPose = entry.up ? poses.get(entry.up.bone) : undefined;
    if (entry.up && upPose?.valid) {
      tmpUpDir.copy(UP).applyQuaternion(upPose.quaternion);
      basisQuat(mA, entry.restDir, entry.up.restDir);
      basisQuat(mB, tmpDir, tmpUpDir);
      tmpDelta.setFromRotationMatrix(mB).multiply(
        tmpParent.setFromRotationMatrix(mA).invert(),
      );
    } else {
      tmpDelta.setFromUnitVectors(entry.restDir, tmpDir);
    }

    tmpWorld.copy(tmpDelta).multiply(entry.restQuat);
    entry.joint.parent!.getWorldQuaternion(tmpParent).invert();
    entry.joint.quaternion.copy(tmpParent.multiply(tmpWorld));
  }
}

/**
 * Orthonormal basis from a primary axis (kept exact) and an approximate up.
 * Written into `out`.
 */
function basisQuat(out: Matrix4, primary: Vector3, approxUp: Vector3): void {
  ax.copy(primary).normalize();
  az.crossVectors(ax, approxUp).normalize();
  ay.crossVectors(az, ax).normalize();
  out.makeBasis(ax, ay, az);
}
