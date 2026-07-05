import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, MeshStandardMaterial, type Material } from "three";
import { poseStore } from "../pose/poseStore";
import { BONES, type BoneDef, type SegmentKind } from "./skeleton";
import { applyBonePoses } from "./applyBonePoses";
import type { Retargeter } from "./retarget";

export interface LayerVisibility {
  skin: boolean;
  muscle: boolean;
  skeleton: boolean;
}

/**
 * Phase 3: the "anatomy" model as rigid limb segments, driven by exactly the
 * same bone poses as the stick figure. Each segment is a parent group holding
 * three concentric layer shells — skeleton (inner), muscle, skin (outer) —
 * that can be toggled independently. Segments rotate rigidly at the joints;
 * there is intentionally no smooth muscle stretch across joints (MVP).
 *
 * TODO(asset): swap these primitives for a real anatomy GLB (Z-Anatomy /
 * BodyParts3D). That asset ships as many separate anatomically-named meshes
 * with no armature or skin weights, so the integration step is: group its
 * meshes into these same rigid segments (one parent Object3D per BoneDef,
 * origin at the proximal joint, +Y toward the distal joint) and this
 * component's driving logic applies unchanged. Mesh grouping/naming needs to
 * be decided together once the GLB is inspected.
 */
export function AnatomySegments({
  retargeter,
  layers,
}: {
  retargeter: Retargeter;
  layers: LayerVisibility;
}) {
  const refs = useRef(new Map<string, Group>());
  const mats = useMemo(
    () => ({
      skin: new MeshStandardMaterial({ color: "#dba777", roughness: 0.6 }),
      muscle: new MeshStandardMaterial({ color: "#a53127", roughness: 0.45 }),
      bone: new MeshStandardMaterial({ color: "#e9dfc8", roughness: 0.55 }),
    }),
    [],
  );

  useFrame(() => {
    const { worldLandmarks, timestampMs } = poseStore.frame;
    const poses = retargeter.update(worldLandmarks, timestampMs);
    applyBonePoses(refs.current, poses);
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
          <group visible={layers.skeleton}>
            {segmentMeshes(bone, "skeleton", mats.bone)}
          </group>
          <group visible={layers.muscle}>
            {segmentMeshes(bone, "muscle", mats.muscle)}
          </group>
          <group visible={layers.skin}>
            {segmentMeshes(bone, "skin", mats.skin)}
          </group>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Segment geometry.                                                   */
/*                                                                     */
/* Length-scaled segments live in "unit space": local Y spans 0..1 and */
/* is stretched to the measured bone length, so heights/Y-offsets are  */
/* fractions of the bone while radii stay in meters. The head is NOT   */
/* length-scaled, so all of its numbers are meters.                    */
/* ------------------------------------------------------------------ */

/** Layer radii (m) for the tube-like limb segments. */
const LIMB_RADII: Partial<
  Record<SegmentKind, { skin: number; muscle: number; bone: number }>
> = {
  upperArm: { skin: 0.048, muscle: 0.038, bone: 0.014 },
  forearm: { skin: 0.04, muscle: 0.031, bone: 0.012 },
  thigh: { skin: 0.07, muscle: 0.056, bone: 0.018 },
  shin: { skin: 0.055, muscle: 0.042, bone: 0.016 },
  foot: { skin: 0.035, muscle: 0.027, bone: 0.012 },
};

function Tube({
  r,
  h,
  y,
  mat,
  sx = 1,
  sz = 1,
}: {
  r: number;
  h: number;
  y: number;
  mat: Material;
  sx?: number;
  sz?: number;
}) {
  return (
    <mesh position={[0, y, 0]} scale={[sx, 1, sz]} material={mat} castShadow>
      <cylinderGeometry args={[r, r, h, 16]} />
    </mesh>
  );
}

function Ball({
  r,
  y,
  mat,
  sx = 1,
  sy = 1,
  sz = 1,
}: {
  r: number;
  y: number;
  mat: Material;
  sx?: number;
  sy?: number;
  sz?: number;
}) {
  return (
    <mesh position={[0, y, 0]} scale={[sx, sy, sz]} material={mat} castShadow>
      <sphereGeometry args={[r, 20, 14]} />
    </mesh>
  );
}

function segmentMeshes(
  bone: BoneDef,
  layer: keyof LayerVisibility,
  mat: Material,
): ReactNode {
  const limb = LIMB_RADII[bone.kind];
  if (limb) {
    // Muscle bellies stop short of the joints so the bone peeks through.
    if (layer === "skeleton") return <Tube r={limb.bone} h={1} y={0.5} mat={mat} />;
    if (layer === "muscle") return <Tube r={limb.muscle} h={0.84} y={0.5} mat={mat} />;
    return <Tube r={limb.skin} h={0.98} y={0.5} mat={mat} />;
  }

  switch (bone.kind) {
    case "torso":
      // Elliptical trunk; local Y spans hips→shoulders (~0.45 m measured).
      if (layer === "skeleton") {
        return (
          <>
            <Tube r={0.018} h={1} y={0.5} mat={mat} />
            {/* Ribcage: sphere's Y is in bone-length fractions, so ~2.2
                compensates the ~0.45 m group stretch to stay ovoid. */}
            <Ball r={0.115} y={0.68} mat={mat} sx={1.35} sy={2.2} sz={0.7} />
          </>
        );
      }
      if (layer === "muscle") {
        return <Tube r={0.135} h={0.94} y={0.5} mat={mat} sx={1.5} sz={0.62} />;
      }
      return <Tube r={0.155} h={1} y={0.5} mat={mat} sx={1.5} sz={0.66} />;

    case "pelvis":
      // Horizontal tube along the left-hip → right-hip axis (~0.24 m).
      if (layer === "skeleton") {
        return (
          <>
            <Tube r={0.028} h={1} y={0.5} mat={mat} />
            {/* Hip ball joints; sy counters the ~0.24 m Y stretch. */}
            <Ball r={0.045} y={0.06} mat={mat} sy={4.2} />
            <Ball r={0.045} y={0.94} mat={mat} sy={4.2} />
          </>
        );
      }
      if (layer === "muscle") {
        return <Tube r={0.115} h={0.92} y={0.5} mat={mat} sx={1.1} sz={0.78} />;
      }
      return <Tube r={0.135} h={1} y={0.5} mat={mat} sx={1.15} sz={0.8} />;

    case "shoulders":
      // Clavicle/trapezius bar between the shoulders.
      if (layer === "skeleton") return <Tube r={0.012} h={1} y={0.5} mat={mat} />;
      if (layer === "muscle") return <Tube r={0.042} h={0.95} y={0.5} mat={mat} sz={0.75} />;
      return <Tube r={0.052} h={1} y={0.5} mat={mat} sz={0.8} />;

    case "head":
      // Metric space (not length-scaled): origin at mid-shoulder, +Y toward
      // mid-ear, skull center ~0.25 m up.
      if (layer === "skeleton") {
        return (
          <>
            <Tube r={0.018} h={0.16} y={0.08} mat={mat} />
            <Ball r={0.082} y={0.25} mat={mat} sx={0.82} sy={1.05} />
          </>
        );
      }
      if (layer === "muscle") {
        return (
          <>
            <Tube r={0.038} h={0.18} y={0.09} mat={mat} />
            <Ball r={0.075} y={0.25} mat={mat} sx={0.85} sz={0.95} />
          </>
        );
      }
      return (
        <>
          <Tube r={0.048} h={0.2} y={0.1} mat={mat} />
          <Ball r={0.092} y={0.25} mat={mat} sx={0.88} sy={1.12} />
        </>
      );

    default:
      return null;
  }
}
