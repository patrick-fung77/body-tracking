import type { Group } from "three";
import { BONES } from "./skeleton";
import type { BonePose } from "./retarget";

/**
 * Copies retargeted bone poses onto their Object3D groups. Each group's
 * origin sits at the proximal joint with geometry extending along local +Y.
 *
 * `forceScale` stretches every bone to the measured joint distance (stick
 * figure: pure lines between landmarks). Otherwise only bones marked
 * `lengthScaled` stretch; the rest keep their authored metric size.
 */
export function applyBonePoses(
  refs: Map<string, Group>,
  poses: Map<string, BonePose>,
  forceScale = false,
): void {
  for (const bone of BONES) {
    const group = refs.get(bone.name);
    const pose = poses.get(bone.name);
    if (!group || !pose) continue;
    group.visible = pose.valid;
    if (!pose.valid) continue;
    group.position.copy(pose.position);
    group.quaternion.copy(pose.quaternion);
    if (bone.lengthScaled || forceScale) {
      group.scale.setY(Math.max(pose.length, 1e-3));
    }
  }
}
