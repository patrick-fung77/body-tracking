import { Quaternion, Vector3 } from "three";
import type { Landmark } from "@mediapipe/tasks-vision";
import { NUM_LANDMARKS } from "../pose/landmarks";
import { BONES, type JointRef } from "./skeleton";

/**
 * Per-bone target transform, world-space (within the rig group):
 * origin at the proximal joint, local +Y pointing at the distal joint.
 */
export interface BonePose {
  position: Vector3;
  quaternion: Quaternion;
  /** Measured proximal→distal distance in meters. */
  length: number;
  /** False until this bone has been seen at least once. */
  valid: boolean;
}

/**
 * COORDINATE SYSTEMS — the one place sign flips live.
 *
 * MediaPipe world landmarks: meters, origin at hip center, X right in the
 * camera image, Y down, Z pointing away from the camera. Three.js: Y up,
 * Z toward the viewer, right-handed. Negating Y and Z is a 180° rotation
 * about X, which maps one onto the other and makes the model face the
 * viewer: raise your right arm and the model raises *its* right arm
 * (screen-left, like a person facing you — not a mirror).
 *
 * `mirror` additionally negates X for a mirror-like display. If left/right
 * or up/down looks wrong empirically, this function is the knob to turn.
 */
function toThree(lm: Landmark, mirror: boolean, out: Vector3): Vector3 {
  return out.set(mirror ? -lm.x : lm.x, -lm.y, -lm.z);
}

const UP = new Vector3(0, 1, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpDir = new Vector3();
const tmpQuat = new Quaternion();

/** Exponential smoothing factor for landmark positions (per pose frame). */
const POS_ALPHA = 0.5;
/** Slerp factor pulling each bone toward its measured rotation (per pose frame). */
const ROT_ALPHA = 0.4;
/** Landmarks below this visibility don't update their bone. */
const MIN_VISIBILITY = 0.4;

/**
 * Converts world landmarks into smoothed per-bone poses. Holds internal
 * smoothing state; when no person is detected it simply keeps returning the
 * last poses (the model freezes instead of collapsing).
 *
 * KNOWN LIMITATION (by design): rotations are minimal twist-free rotations
 * of the rest direction (+Y) onto the measured direction. Twist/roll about
 * the bone's own axis (e.g. forearm pronation) is not recoverable from
 * point landmarks and is intentionally not attempted.
 */
export class Retargeter {
  mirror = false;

  private smoothed: (Vector3 | null)[] = new Array<Vector3 | null>(
    NUM_LANDMARKS,
  ).fill(null);
  private poses = new Map<string, BonePose>();
  private lastTimestamp = -1;

  constructor() {
    for (const bone of BONES) {
      this.poses.set(bone.name, {
        position: new Vector3(),
        quaternion: new Quaternion(),
        length: 0,
        valid: false,
      });
    }
  }

  /**
   * Idempotent per pose frame: safe to call from multiple useFrame loops;
   * smoothing only advances when a new inference result has arrived.
   */
  update(world: Landmark[] | null, timestampMs: number): Map<string, BonePose> {
    if (!world || timestampMs === this.lastTimestamp) return this.poses;
    this.lastTimestamp = timestampMs;

    for (let i = 0; i < NUM_LANDMARKS; i++) {
      const lm = world[i];
      if (!lm) continue;
      toThree(lm, this.mirror, tmpA);
      const prev = this.smoothed[i];
      if (prev) prev.lerp(tmpA, POS_ALPHA);
      else this.smoothed[i] = tmpA.clone();
    }

    for (const bone of BONES) {
      const pose = this.poses.get(bone.name)!;
      if (!this.jointPosition(bone.a, world, tmpA)) continue;
      if (!this.jointPosition(bone.b, world, tmpB)) continue;

      tmpDir.subVectors(tmpB, tmpA);
      const length = tmpDir.length();
      if (length < 1e-4) continue;
      tmpDir.divideScalar(length);
      tmpQuat.setFromUnitVectors(UP, tmpDir);

      if (!pose.valid) {
        pose.position.copy(tmpA);
        pose.quaternion.copy(tmpQuat);
        pose.length = length;
        pose.valid = true;
      } else {
        // Positions come from already-smoothed landmarks; copy directly.
        pose.position.copy(tmpA);
        pose.quaternion.slerp(tmpQuat, ROT_ALPHA);
        pose.length += (length - pose.length) * POS_ALPHA;
      }
    }
    return this.poses;
  }

  get currentPoses(): Map<string, BonePose> {
    return this.poses;
  }

  /** Reset smoothing state (e.g. when toggling mirror, to avoid a long glide). */
  reset(): void {
    this.smoothed.fill(null);
    for (const pose of this.poses.values()) pose.valid = false;
    this.lastTimestamp = -1;
  }

  /**
   * Smoothed position of a joint ref (single landmark or midpoint of two).
   * Returns false if the joint isn't sufficiently visible yet.
   */
  private jointPosition(
    ref: JointRef,
    world: Landmark[],
    out: Vector3,
  ): boolean {
    if (typeof ref === "number") {
      const s = this.smoothed[ref];
      if (!s || !this.isVisible(world, ref)) return false;
      out.copy(s);
      return true;
    }
    const [i, j] = ref;
    const si = this.smoothed[i];
    const sj = this.smoothed[j];
    if (!si || !sj || !this.isVisible(world, i) || !this.isVisible(world, j)) {
      return false;
    }
    out.addVectors(si, sj).multiplyScalar(0.5);
    return true;
  }

  private isVisible(world: Landmark[], index: number): boolean {
    const v = world[index]?.visibility;
    // Some runtimes omit visibility; treat missing as visible.
    return v === undefined || v >= MIN_VISIBILITY;
  }
}
