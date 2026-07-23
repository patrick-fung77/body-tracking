import { Bone, Object3D, Vector3 } from "three";

/**
 * Automatic humanoid rig detection for arbitrary GLB models, so users can
 * import any rigged character without hand-written per-model bone maps.
 *
 * Strategy: bone names alone are unreliable across authoring tools (DAZ
 * "lShldr", Blender "upper_arm.L", Mixamo "LeftArm", Auto-Rig-Pro
 * "arm_stretch_l"...), so detection anchors on the few keywords that ARE
 * consistent (forearm, shin, hand, foot, neck, head) and derives the rest
 * structurally:
 *
 * - upper arm  = nearest ancestor of the forearm at a different position
 *   (skips co-located wrapper/scale-compensation nodes)
 * - thigh      = same, from the shin
 * - hip        = deepest common ancestor of both thighs
 * - chest      = deepest common ancestor of both upper arms
 * - facing     = inferred from the left→right hip axis, so models authored
 *   facing away from the camera flip automatically
 *
 * Twist/IK/control helper bones are excluded by keyword.
 */

/** One retargeted bone (BonePose key from rig/skeleton.ts) → one joint. */
export interface ResolvedBinding {
  joint: Object3D;
  bone: string;
  restFrom: Object3D;
  restTo: Object3D;
  up?: { bone: string; restFrom: Object3D; restTo: Object3D };
}

export interface DetectedRig {
  hip: Object3D;
  bindings: ResolvedBinding[];
  /** True when the model's rest pose faces away from the viewer (-Z). */
  flipFacing: boolean;
}

type Side = "l" | "r";

interface Candidate {
  node: Object3D;
  score: number;
  isBone: boolean;
  tokenCount: number;
}

const EXCLUDE_TOKENS = new Set([
  "ik",
  "ctrl",
  "control",
  "pole",
  "twist",
  "roll",
  "helper",
  "target",
  "jiggle",
  "phys",
  "dyn",
]);

/** "lShldr_049" → ["l","shldr"]; "forearmL" → ["forearm","l"]; etc. */
function tokenize(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function sideOf(toks: string[]): Side | null {
  if (toks.includes("left") || toks.includes("l")) return "l";
  if (toks.includes("right") || toks.includes("r")) return "r";
  return null;
}

interface NodeInfo {
  node: Object3D;
  toks: string[];
  joined: string;
  side: Side | null;
  excluded: boolean;
  isBone: boolean;
}

function scorePart(part: string, info: NodeInfo): number {
  const { toks, joined } = info;
  const has = (t: string) => toks.includes(t);
  switch (part) {
    case "forearm":
      if (joined.includes("forearm") || joined.includes("lowerarm")) return 3;
      if (has("elbow")) return 2;
      return 0;
    case "shin":
      if (
        joined.includes("shin") ||
        joined.includes("calf") ||
        joined.includes("lowerleg")
      ) {
        return 3;
      }
      if (has("knee")) return 2;
      // Mixamo-style "LeftLeg" = shin; but "LeftUpLeg"/"upperleg" = thigh.
      if (
        has("leg") &&
        !joined.includes("upleg") &&
        !joined.includes("upperleg") &&
        !joined.includes("thigh")
      ) {
        return 1;
      }
      return 0;
    case "hand":
      if (has("hand") || has("wrist")) return 2;
      return 0;
    case "foot":
      if (has("foot") || has("ankle")) return 2;
      return 0;
    case "toe":
      if (joined.includes("toe")) return 2;
      return 0;
    case "neck":
      if (has("neck")) return 3;
      if (joined.includes("neck")) return 1;
      return 0;
    case "head":
      if (has("head")) return 2;
      return 0;
    default:
      return 0;
  }
}

const SIDED_PARTS = ["forearm", "shin", "hand", "foot", "toe"] as const;
const CENTER_PARTS = ["neck", "head"] as const;

export function detectHumanoidRig(scene: Object3D): DetectedRig {
  const infos: NodeInfo[] = [];
  let anyBone = false;
  scene.traverse((node) => {
    if (!node.name) return;
    const toks = tokenize(node.name);
    if (toks.length === 0) return;
    const isBone = node instanceof Bone;
    anyBone ||= isBone;
    infos.push({
      node,
      toks,
      joined: toks.join(""),
      side: sideOf(toks),
      excluded: toks.some((t) => EXCLUDE_TOKENS.has(t)),
      isBone,
    });
  });

  // Scale-relative epsilon for "same position" checks.
  const size = new Vector3();
  sceneSize(scene, size);
  const eps = Math.max(size.length() * 1e-3, 1e-6);

  const pick = (part: string, side: Side | null): Object3D | null => {
    const candidates: Candidate[] = [];
    for (const info of infos) {
      if (info.excluded || info.side !== side) continue;
      const score = scorePart(part, info);
      if (score > 0) {
        candidates.push({
          node: info.node,
          score,
          isBone: info.isBone,
          tokenCount: info.toks.length,
        });
      }
    }
    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.isBone) - Number(a.isBone) ||
        a.tokenCount - b.tokenCount ||
        a.node.name.length - b.node.name.length,
    );
    return candidates[0]?.node ?? null;
  };

  const found: Partial<Record<string, Object3D | null>> = {};
  for (const part of SIDED_PARTS) {
    found[`${part}L`] = pick(part, "l");
    found[`${part}R`] = pick(part, "r");
  }
  for (const part of CENTER_PARTS) found[part] = pick(part, null);

  const missing: string[] = [];
  for (const key of ["forearmL", "forearmR", "shinL", "shinR"]) {
    if (!found[key]) missing.push(key.replace(/([LR])$/, " ($1)"));
  }
  if (missing.length > 0) {
    throw new Error(
      anyBone || infos.length > 0
        ? `couldn't recognize a humanoid skeleton (missing: ${missing.join(", ")})`
        : "this model has no named skeleton joints — it isn't rigged",
    );
  }

  const forearmL = found.forearmL!;
  const forearmR = found.forearmR!;
  const shinL = found.shinL!;
  const shinR = found.shinR!;

  const upperArmL = properParent(forearmL, eps);
  const upperArmR = properParent(forearmR, eps);
  const thighL = properParent(shinL, eps);
  const thighR = properParent(shinR, eps);
  if (!upperArmL || !upperArmR || !thighL || !thighR) {
    throw new Error(
      "couldn't find upper-arm/thigh joints above the forearms and shins",
    );
  }

  const hip = commonAncestor(thighL, thighR);
  if (!hip || hip === thighL || hip === thighR) {
    throw new Error("couldn't find a hip joint above both thighs");
  }
  const chestRaw = commonAncestor(upperArmL, upperArmR);
  const chest =
    chestRaw && chestRaw !== hip && isDescendantOf(chestRaw, hip)
      ? chestRaw
      : null;

  const neck =
    found.neck && chest && isDescendantOf(found.neck, chest)
      ? found.neck
      : null;
  const head =
    found.head && neck && isDescendantOf(found.head, neck) ? found.head : null;

  const handL = validDescendant(found.handL, forearmL);
  const handR = validDescendant(found.handR, forearmR);
  const footL = validDescendant(found.footL, shinL);
  const footR = validDescendant(found.footR, shinR);
  const toeL = validDescendant(found.toeL, footL);
  const toeR = validDescendant(found.toeR, footR);

  const torsoUpTo = neck ?? chest;
  const bindings: ResolvedBinding[] = [
    {
      joint: hip,
      bone: "pelvis",
      restFrom: thighL,
      restTo: thighR,
      ...(torsoUpTo && {
        up: { bone: "torso", restFrom: hip, restTo: torsoUpTo },
      }),
    },
  ];
  if (chest) {
    bindings.push({
      joint: chest,
      bone: "shoulders",
      restFrom: upperArmL,
      restTo: upperArmR,
      up: { bone: "torso", restFrom: hip, restTo: torsoUpTo! },
    });
  }
  if (neck && head) {
    bindings.push({ joint: neck, bone: "head", restFrom: neck, restTo: head });
  }
  const limb = (
    joint: Object3D,
    bone: string,
    restTo: Object3D | null,
  ): void => {
    if (restTo) {
      bindings.push({ joint, bone, restFrom: joint, restTo });
    }
  };
  limb(upperArmL, "leftUpperArm", forearmL);
  limb(forearmL, "leftForearm", handL ?? distalChild(forearmL, eps));
  limb(upperArmR, "rightUpperArm", forearmR);
  limb(forearmR, "rightForearm", handR ?? distalChild(forearmR, eps));
  limb(thighL, "leftThigh", shinL);
  limb(shinL, "leftShin", footL ?? distalChild(shinL, eps));
  limb(thighR, "rightThigh", shinR);
  limb(shinR, "rightShin", footR ?? distalChild(shinR, eps));
  if (footL && toeL) limb(footL, "leftFoot", toeL);
  if (footR && toeR) limb(footR, "rightFoot", toeR);

  // Parents must be driven before children.
  bindings.sort((a, b) => depthOf(a.joint) - depthOf(b.joint));

  // Facing: for a viewer-facing model, forward = worldUp × (left→right hip
  // axis) points toward +Z. If it points away, the model shows its back.
  const pL = thighL.getWorldPosition(new Vector3());
  const pR = thighR.getWorldPosition(new Vector3());
  const lateral = pR.sub(pL);
  const forward = new Vector3(0, 1, 0).cross(lateral);
  const flipFacing = forward.z < -Math.abs(forward.x);

  return { hip, bindings, flipFacing };
}

/* ------------------------------------------------------------------ */

const tmpA = new Vector3();
const tmpB = new Vector3();

/**
 * Nearest ancestor whose world position actually differs from the node's —
 * skips co-located wrappers (e.g. Auto-Rig-Pro scale-compensation nodes).
 */
function properParent(node: Object3D, eps: number): Object3D | null {
  node.getWorldPosition(tmpA);
  for (let p = node.parent; p; p = p.parent) {
    if (p.getWorldPosition(tmpB).distanceTo(tmpA) > eps) return p;
  }
  return null;
}

/** Child (or co-located wrapper's child) at a real distance from the node. */
function distalChild(node: Object3D, eps: number): Object3D | null {
  node.getWorldPosition(tmpA);
  let best: Object3D | null = null;
  let bestDist = 0;
  node.traverse((child) => {
    if (child === node) return;
    const d = child.getWorldPosition(tmpB).distanceTo(tmpA);
    if (d > eps && (best === null || d < bestDist)) {
      best = child;
      bestDist = d;
    }
  });
  return best;
}

function isDescendantOf(node: Object3D, ancestor: Object3D): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (p === ancestor) return true;
  }
  return false;
}

function validDescendant(
  node: Object3D | null | undefined,
  ancestor: Object3D | null,
): Object3D | null {
  return node && ancestor && isDescendantOf(node, ancestor) ? node : null;
}

function commonAncestor(a: Object3D, b: Object3D): Object3D | null {
  const ancestors = new Set<Object3D>();
  for (let p = a.parent; p; p = p.parent) ancestors.add(p);
  for (let p = b.parent; p; p = p.parent) {
    if (ancestors.has(p)) return p;
  }
  return null;
}

function depthOf(node: Object3D): number {
  let d = 0;
  for (let p = node.parent; p; p = p.parent) d++;
  return d;
}

function sceneSize(scene: Object3D, out: Vector3): void {
  // Rough extent from joint positions; avoids a full geometry bbox pass.
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  scene.traverse((n) => {
    n.getWorldPosition(tmpA);
    min.min(tmpA);
    max.max(tmpA);
  });
  out.subVectors(max, min);
}
