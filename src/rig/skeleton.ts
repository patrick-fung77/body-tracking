import { LM } from "../pose/landmarks";

/** A landmark index, or a pair to be averaged (e.g. mid-hip). */
export type JointRef = number | readonly [number, number];

export type SegmentKind =
  | "torso"
  | "pelvis"
  | "shoulders"
  | "head"
  | "upperArm"
  | "forearm"
  | "thigh"
  | "shin"
  | "foot";

export interface BoneDef {
  name: string;
  /** Proximal joint — bone origin. */
  a: JointRef;
  /** Distal joint — bone tip. */
  b: JointRef;
  kind: SegmentKind;
  side?: "left" | "right";
  /** Stick-figure cylinder radius (m). */
  radius: number;
  /**
   * If true the bone's local Y is scaled to the measured joint distance
   * (limbs, torso). If false the geometry keeps its authored metric size and
   * is only positioned/oriented (head, pelvis/shoulder bars, feet) — their
   * measured lengths are noisy and the shapes shouldn't stretch.
   */
  lengthScaled: boolean;
}

const MID_HIP = [LM.LEFT_HIP, LM.RIGHT_HIP] as const;
const MID_SHOULDER = [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER] as const;
const MID_EAR = [LM.LEFT_EAR, LM.RIGHT_EAR] as const;

export const BONES: BoneDef[] = [
  { name: "torso", a: MID_HIP, b: MID_SHOULDER, kind: "torso", radius: 0.05, lengthScaled: true },
  { name: "pelvis", a: LM.LEFT_HIP, b: LM.RIGHT_HIP, kind: "pelvis", radius: 0.04, lengthScaled: true },
  { name: "shoulders", a: LM.LEFT_SHOULDER, b: LM.RIGHT_SHOULDER, kind: "shoulders", radius: 0.035, lengthScaled: true },
  { name: "head", a: MID_SHOULDER, b: MID_EAR, kind: "head", radius: 0.03, lengthScaled: false },

  { name: "leftUpperArm", a: LM.LEFT_SHOULDER, b: LM.LEFT_ELBOW, kind: "upperArm", side: "left", radius: 0.025, lengthScaled: true },
  { name: "leftForearm", a: LM.LEFT_ELBOW, b: LM.LEFT_WRIST, kind: "forearm", side: "left", radius: 0.02, lengthScaled: true },
  { name: "rightUpperArm", a: LM.RIGHT_SHOULDER, b: LM.RIGHT_ELBOW, kind: "upperArm", side: "right", radius: 0.025, lengthScaled: true },
  { name: "rightForearm", a: LM.RIGHT_ELBOW, b: LM.RIGHT_WRIST, kind: "forearm", side: "right", radius: 0.02, lengthScaled: true },

  { name: "leftThigh", a: LM.LEFT_HIP, b: LM.LEFT_KNEE, kind: "thigh", side: "left", radius: 0.032, lengthScaled: true },
  { name: "leftShin", a: LM.LEFT_KNEE, b: LM.LEFT_ANKLE, kind: "shin", side: "left", radius: 0.025, lengthScaled: true },
  { name: "rightThigh", a: LM.RIGHT_HIP, b: LM.RIGHT_KNEE, kind: "thigh", side: "right", radius: 0.032, lengthScaled: true },
  { name: "rightShin", a: LM.RIGHT_KNEE, b: LM.RIGHT_ANKLE, kind: "shin", side: "right", radius: 0.025, lengthScaled: true },

  { name: "leftFoot", a: LM.LEFT_ANKLE, b: LM.LEFT_FOOT_INDEX, kind: "foot", side: "left", radius: 0.02, lengthScaled: true },
  { name: "rightFoot", a: LM.RIGHT_ANKLE, b: LM.RIGHT_FOOT_INDEX, kind: "foot", side: "right", radius: 0.02, lengthScaled: true },
];
