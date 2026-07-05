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

export const SKELETON_MODEL_URL = `${import.meta.env.BASE_URL}models/female_skeleton.glb`;

/** Overall model height after normalization (m). */
const MODEL_HEIGHT = 1.66;
/**
 * The GLB's rest pose faces +Z after normalization if this is false; flip if
 * the model shows its back to the camera. Applied before rest capture, so
 * all retargeting math stays consistent either way.
 */
const FLIP_FACING = false;

/**
 * Phase 3 (real asset): drives the rigged Sketchfab skeleton
 * (public/models/female_skeleton.glb) with the same retargeted bone poses as
 * the other views, but through its actual armature, so the skinned bone
 * meshes articulate at the joints.
 *
 * Binding strategy: for each driven joint we record, at load time, its rest
 * world orientation and the rest world direction toward a reference child
 * joint (e.g. lShldr → lForeArm). Each frame the delta rotation that carries
 * the rest direction onto the measured landmark direction is applied on top
 * of the rest orientation, in world space, then converted to the joint's
 * local space (parents are processed first). The hip and chest use a
 * two-axis (lateral + up) alignment so body yaw and lean come through.
 */
export function SkeletonModel({ retargeter }: { retargeter: Retargeter }) {
  const { scene } = useGLTF(SKELETON_MODEL_URL);
  const rig = useMemo(() => buildRig(scene), [scene]);

  useFrame(() => {
    const { worldLandmarks, timestampMs } = poseStore.frame;
    const poses = retargeter.update(worldLandmarks, timestampMs);
    driveRig(rig, poses);
  });

  return <primitive object={rig.wrapper} />;
}

useGLTF.preload(SKELETON_MODEL_URL);

/* ------------------------------------------------------------------ */

/**
 * Joint bindings, parent-first (parents must be driven before children so
 * world-space math sees updated ancestors). Joint names are the GLB's with
 * the numeric suffix stripped ("lShldr_049" → "lShldr"). `restTo` names the
 * joint whose rest position defines the bone's rest direction. Bones whose
 * BoneDef runs a→b (e.g. pelvis: LEFT_HIP→RIGHT_HIP) get matching rest refs
 * (lThigh→rThigh).
 */
interface BindingDef {
  joint: string;
  bone: string;
  restFrom?: string; // defaults to `joint`
  restTo: string;
  up?: { bone: string; restFrom: string; restTo: string };
}

const BINDINGS: BindingDef[] = [
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
];

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

function buildRig(scene: Group): Rig {
  const cached = rigCache.get(scene);
  if (cached) return cached;
  const rig = buildRigUncached(scene);
  rigCache.set(scene, rig);
  return rig;
}

function buildRigUncached(scene: Group): Rig {
  const wrapper = new Group();
  wrapper.add(scene);
  if (FLIP_FACING) wrapper.rotation.y = Math.PI;

  const byName = new Map<string, Object3D>();
  scene.traverse((o) => {
    const key = stripSuffix(o.name);
    if (!byName.has(key)) byName.set(key, o);
    if (o instanceof Mesh) {
      // Skinned meshes move far from their authored bounds once posed.
      o.frustumCulled = false;
      o.castShadow = true;
    }
  });
  const joint = (name: string): Object3D => {
    const o = byName.get(name);
    if (!o) throw new Error(`GLB joint not found: ${name}`);
    return o;
  };

  // Normalize: uniform scale to human height, hips at wrapper origin.
  wrapper.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const height = box.max.y - box.min.y;
  if (height > 1e-3) scene.scale.multiplyScalar(MODEL_HEIGHT / height);
  wrapper.updateMatrixWorld(true);
  const hipWorld = joint("hip").getWorldPosition(new Vector3());
  scene.position.sub(hipWorld);
  wrapper.updateMatrixWorld(true);

  // Re-bind skinned meshes: scaling an ancestor after binding otherwise
  // applies the scale twice through the bone-matrix path (bind matrices and
  // bone inverses were captured pre-scale). Must run while still in rest pose.
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
  const entries: RigEntry[] = BINDINGS.map((b) => ({
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
