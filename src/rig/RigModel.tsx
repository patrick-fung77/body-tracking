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
import type { BonePose, Retargeter } from "./retarget";

/**
 * Drives a rigged GLB character with the retargeted bone poses, through its
 * actual armature joints. Model-agnostic: everything model-specific (joint
 * names, facing, height) lives in a RigModelConfig.
 *
 * Binding strategy: for each driven joint we record, at load time, its rest
 * world orientation and the rest world direction toward a reference child
 * joint (e.g. upper arm → forearm). Each frame the delta rotation that
 * carries the rest direction onto the measured landmark direction is applied
 * on top of the rest orientation, in world space, then converted to the
 * joint's local space (parents are processed first). The hip and chest use a
 * two-axis (lateral + up) alignment so body yaw and lean come through.
 */

/**
 * Height of the rig group above the ground plane (world landmarks are
 * hip-origin). Scene3D positions the rig group at this Y; models compensate
 * for their own leg length inside buildRig so their feet rest on the ground.
 */
export const HIP_HEIGHT = 0.95;

/** Maps one retargeted bone onto one armature joint. */
export interface BindingDef {
  /** Joint to rotate. */
  joint: string;
  /** BonePose (from rig/skeleton.ts) that supplies the direction (a→b). */
  bone: string;
  /** Joint whose rest position marks the direction start; defaults to `joint`. */
  restFrom?: string;
  /** Joint whose rest position marks the direction end. */
  restTo: string;
  /** Optional second axis for full-basis alignment (hip/chest). */
  up?: { bone: string; restFrom: string; restTo: string };
}

export interface RigModelConfig {
  url: string;
  /** Normalized standing height (m). */
  height: number;
  /** Joint placed at the rig group origin (world landmarks are hip-origin). */
  hipJoint: string;
  /** Rotate the model 180° if its rest pose faces away from the camera. */
  flipFacing: boolean;
  bindings: BindingDef[];
}

/**
 * Sketchfab female skeleton: Poser-style joint names carrying numeric
 * suffixes ("lShldr_049") which the name lookup strips.
 */
export const FEMALE_SKELETON: RigModelConfig = {
  url: `${import.meta.env.BASE_URL}models/female_skeleton.glb`,
  height: 1.66,
  hipJoint: "hip",
  flipFacing: false,
  bindings: [
    {
      joint: "hip",
      bone: "pelvis",
      restFrom: "lThigh",
      restTo: "rThigh",
      up: { bone: "torso", restFrom: "hip", restTo: "chest" },
    },
    {
      joint: "chest",
      bone: "shoulders",
      restFrom: "lShldr",
      restTo: "rShldr",
      up: { bone: "torso", restFrom: "hip", restTo: "neck" },
    },
    { joint: "neck", bone: "head", restTo: "head" },
    { joint: "lShldr", bone: "leftUpperArm", restTo: "lForeArm" },
    { joint: "lForeArm", bone: "leftForearm", restTo: "lHand" },
    { joint: "rShldr", bone: "rightUpperArm", restTo: "rForeArm" },
    { joint: "rForeArm", bone: "rightForearm", restTo: "rHand" },
    { joint: "lThigh", bone: "leftThigh", restTo: "lShin" },
    { joint: "lShin", bone: "leftShin", restTo: "lFoot" },
    { joint: "lFoot", bone: "leftFoot", restTo: "lToe" },
    { joint: "rThigh", bone: "rightThigh", restTo: "rShin" },
    { joint: "rShin", bone: "rightShin", restTo: "rFoot" },
    { joint: "rFoot", bone: "rightFoot", restTo: "rToe" },
  ],
};

/**
 * Blender-authored cartoon character. FK joints only — the CTRL_* IK helper
 * bones are ignored. Its feet have no toe joint, so feet aren't driven and
 * stay rigid relative to the shins.
 */
export const PINK_CHARACTER: RigModelConfig = {
  url: `${import.meta.env.BASE_URL}models/pink-character.glb`,
  height: 1.6,
  hipJoint: "pelvis",
  flipFacing: false,
  bindings: [
    {
      joint: "pelvis",
      bone: "pelvis",
      restFrom: "thigh.L",
      restTo: "thigh.R",
      up: { bone: "torso", restFrom: "pelvis", restTo: "chest" },
    },
    {
      joint: "chest",
      bone: "shoulders",
      restFrom: "upper_arm.L",
      restTo: "upper_arm.R",
      up: { bone: "torso", restFrom: "pelvis", restTo: "neck" },
    },
    { joint: "neck", bone: "head", restTo: "head" },
    { joint: "upper_arm.L", bone: "leftUpperArm", restTo: "forearm.L" },
    { joint: "forearm.L", bone: "leftForearm", restTo: "hand.L" },
    { joint: "upper_arm.R", bone: "rightUpperArm", restTo: "forearm.R" },
    { joint: "forearm.R", bone: "rightForearm", restTo: "hand.R" },
    { joint: "thigh.L", bone: "leftThigh", restTo: "shin.L" },
    { joint: "shin.L", bone: "leftShin", restTo: "foot.L" },
    { joint: "thigh.R", bone: "rightThigh", restTo: "shin.R" },
    { joint: "shin.R", bone: "rightShin", restTo: "foot.R" },
  ],
};

/**
 * "BOT MECHA WARRIOR 3D" by Oscar Creativo (Sketchfab; Auto-Rig-Pro-style
 * rig with stretch/twist bones and scale-compensation wrapper nodes). Only
 * the stretch chain is driven; twist and finger bones follow rigidly.
 * Source asset was Draco+WebP compressed from 50 MB to ~6 MB.
 */
export const MECHA_WARRIOR: RigModelConfig = {
  url: `${import.meta.env.BASE_URL}models/mecha_warrior.glb`,
  height: 1.85,
  hipJoint: "root_x",
  flipFacing: false,
  bindings: [
    {
      joint: "root_x",
      bone: "pelvis",
      restFrom: "thigh_stretch_l",
      restTo: "thigh_stretch_r",
      up: { bone: "torso", restFrom: "root_x", restTo: "spine_05_x" },
    },
    {
      joint: "spine_03_x",
      bone: "shoulders",
      restFrom: "shoulder_l",
      restTo: "shoulder_r",
      up: { bone: "torso", restFrom: "root_x", restTo: "neck_x" },
    },
    { joint: "neck_x", bone: "head", restTo: "head_x" },
    { joint: "arm_stretch_l", bone: "leftUpperArm", restTo: "forearm_stretch_l" },
    { joint: "forearm_stretch_l", bone: "leftForearm", restTo: "hand_l" },
    { joint: "arm_stretch_r", bone: "rightUpperArm", restTo: "forearm_stretch_r" },
    { joint: "forearm_stretch_r", bone: "rightForearm", restTo: "hand_r" },
    { joint: "thigh_stretch_l", bone: "leftThigh", restTo: "leg_stretch_l" },
    { joint: "leg_stretch_l", bone: "leftShin", restTo: "foot_l" },
    { joint: "foot_l", bone: "leftFoot", restTo: "toes_01_l" },
    { joint: "thigh_stretch_r", bone: "rightThigh", restTo: "leg_stretch_r" },
    { joint: "leg_stretch_r", bone: "rightShin", restTo: "foot_r" },
    { joint: "foot_r", bone: "rightFoot", restTo: "toes_01_r" },
  ],
};

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

function stripSuffix(name: string): string {
  return name.replace(/_\d+$/, "");
}

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
  if (config.flipFacing) wrapper.rotation.y = Math.PI;

  // Exact node names take precedence; suffix-stripped names ("lShldr_049" →
  // "lShldr") fill in as aliases.
  const byName = new Map<string, Object3D>();
  scene.traverse((o) => {
    if (o.name && !byName.has(o.name)) byName.set(o.name, o);
    if (o instanceof Mesh) o.castShadow = true;
    if (o instanceof SkinnedMesh) o.frustumCulled = false;
  });
  scene.traverse((o) => {
    const key = stripSuffix(o.name);
    if (key && !byName.has(key)) byName.set(key, o);
  });
  const joint = (name: string): Object3D => {
    // GLTFLoader sanitizes node names (Blender's "thigh.R" loads as
    // "thighR"), so fall back to the dot/space-stripped form.
    const o = byName.get(name) ?? byName.get(name.replace(/[.\s]/g, ""));
    if (!o) throw new Error(`${config.url}: joint not found: ${name}`);
    return o;
  };

  // Normalize: uniform scale to human height, hips at wrapper origin.
  wrapper.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const height = box.max.y - box.min.y;
  if (height > 1e-3) scene.scale.multiplyScalar(config.height / height);
  wrapper.updateMatrixWorld(true);
  const hipWorld = joint(config.hipJoint).getWorldPosition(new Vector3());
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
  const worldPos = (name: string) => joint(name).getWorldPosition(new Vector3());
  const entries: RigEntry[] = config.bindings.map((b) => ({
    joint: joint(b.joint),
    bone: b.bone,
    restDir: worldPos(b.restTo)
      .sub(worldPos(b.restFrom ?? b.joint))
      .normalize(),
    restQuat: joint(b.joint).getWorldQuaternion(new Quaternion()),
    up: b.up && {
      bone: b.up.bone,
      restDir: worldPos(b.up.restTo).sub(worldPos(b.up.restFrom)).normalize(),
    },
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
