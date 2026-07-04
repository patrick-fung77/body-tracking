import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Mesh, Vector3 } from "three";
import { poseStore } from "../pose/poseStore";
import { BONES } from "./skeleton";
import { applyBonePoses } from "./applyBonePoses";
import type { Retargeter } from "./retarget";

const HEAD_TIP_OFFSET = new Vector3();

/**
 * Phase 2: the humanoid stick figure. Each bone is a unit-height cylinder
 * (origin at the proximal joint, +Y toward the distal joint) stretched to
 * the measured landmark distance each frame. Left bones are blue, right
 * bones orange, so left/right mix-ups are obvious at a glance.
 */
export function StickFigure({ retargeter }: { retargeter: Retargeter }) {
  const refs = useRef(new Map<string, Group>());
  const headRef = useRef<Mesh>(null);

  useFrame(() => {
    const { worldLandmarks, timestampMs } = poseStore.frame;
    const poses = retargeter.update(worldLandmarks, timestampMs);
    applyBonePoses(refs.current, poses, true);

    // Head ball rides on the tip of the neck/head bone.
    const head = poses.get("head");
    const ball = headRef.current;
    if (head && ball) {
      ball.visible = head.valid;
      if (head.valid) {
        HEAD_TIP_OFFSET.set(0, head.length + 0.06, 0)
          .applyQuaternion(head.quaternion)
          .add(head.position);
        ball.position.copy(HEAD_TIP_OFFSET);
      }
    }
  });

  return (
    <group>
      {BONES.map((bone) => (
        <group
          key={bone.name}
          visible={false}
          ref={(g: Group | null) => {
            if (g) refs.current.set(bone.name, g);
            else refs.current.delete(bone.name);
          }}
        >
          <mesh position={[0, 0.5, 0]} castShadow>
            <cylinderGeometry args={[bone.radius, bone.radius, 1, 12]} />
            <meshStandardMaterial
              color={
                bone.side === "left"
                  ? "#4da3ff"
                  : bone.side === "right"
                    ? "#ff9f43"
                    : "#cfd6dd"
              }
            />
          </mesh>
        </group>
      ))}
      <mesh ref={headRef} visible={false} castShadow>
        <sphereGeometry args={[0.09, 20, 16]} />
        <meshStandardMaterial color="#cfd6dd" />
      </mesh>
    </group>
  );
}
