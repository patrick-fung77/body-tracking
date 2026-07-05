import type { Landmark, NormalizedLandmark } from "@mediapipe/tasks-vision";

/**
 * Latest pose result, written by the inference loop and read by the 2D
 * overlay and the 3D render loop. Deliberately a plain mutable singleton
 * (not React state): pose frames arrive up to ~30x/s and consumers poll it
 * from their own animation loops, so inference and rendering stay decoupled.
 */
export interface PoseFrame {
  /** Normalized image-space landmarks (for the 2D overlay). Null = no person. */
  imageLandmarks: NormalizedLandmark[] | null;
  /** Metric world landmarks, origin at hip center (for 3D retargeting). */
  worldLandmarks: Landmark[] | null;
  /** performance.now() timestamp of the frame this result belongs to. */
  timestampMs: number;
}

export interface PoseStore {
  frame: PoseFrame;
  /** Pose inference throughput, updated ~2x/s. */
  inferenceFps: number;
  /** Last time (performance.now()) a person was actually detected. */
  lastDetectionMs: number;
}

export const poseStore: PoseStore = {
  frame: { imageLandmarks: null, worldLandmarks: null, timestampMs: -1 },
  inferenceFps: 0,
  lastDetectionMs: 0,
};
