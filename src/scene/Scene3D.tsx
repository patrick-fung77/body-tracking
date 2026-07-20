import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls, Stats } from "@react-three/drei";
import { StickFigure } from "../rig/StickFigure";
import {
  RigModel,
  FEMALE_SKELETON,
  PINK_CHARACTER,
  MECHA_WARRIOR,
  HIP_HEIGHT as RIG_HIP_HEIGHT,
  type RigModelConfig,
} from "../rig/RigModel";
import {
  AnatomySegments,
  type LayerVisibility,
} from "../rig/AnatomySegments";
import type { Retargeter } from "../rig/retarget";

export type ViewMode = "skeleton3d" | "pink" | "mecha" | "anatomy" | "stick";

const RIG_CONFIGS: Partial<Record<ViewMode, RigModelConfig>> = {
  skeleton3d: FEMALE_SKELETON,
  pink: PINK_CHARACTER,
  mecha: MECHA_WARRIOR,
};

/** World landmarks are hip-origin, so lift the rig to standing height. */
const HIP_HEIGHT = RIG_HIP_HEIGHT;

export function Scene3D({
  retargeter,
  view,
  layers,
  showAxes,
}: {
  retargeter: Retargeter;
  view: ViewMode;
  layers: LayerVisibility;
  showAxes: boolean;
}) {
  return (
    <Canvas shadows camera={{ position: [0, 1.5, 2.8], fov: 50 }}>
      <color attach="background" args={["#22262b"]} />
      <fog attach="fog" args={["#22262b", 6, 14]} />

      {/* Key + fill + ambient */}
      <hemisphereLight args={["#cfd8e6", "#33383e", 0.55]} />
      <directionalLight
        position={[2.5, 4, 2.5]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={2.5}
        shadow-camera-bottom={-0.5}
      />
      <directionalLight position={[-3, 2, -2]} intensity={0.4} />

      <group position={[0, HIP_HEIGHT, 0]}>
        {view === "stick" && <StickFigure retargeter={retargeter} />}
        {view === "anatomy" && (
          <AnatomySegments retargeter={retargeter} layers={layers} />
        )}
        {RIG_CONFIGS[view] && (
          <Suspense
            fallback={
              <Html center>
                <div className="model-loading">Loading 3D model…</div>
              </Html>
            }
          >
            <RigModel retargeter={retargeter} config={RIG_CONFIGS[view]} />
          </Suspense>
        )}
        {showAxes && <axesHelper args={[0.6]} />}
      </group>

      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[4, 48]} />
        <meshStandardMaterial color="#3c4147" />
      </mesh>
      <gridHelper args={[8, 16, "#565d66", "#2e3338"]} position={[0, 0.001, 0]} />

      <OrbitControls
        makeDefault
        target={[0, 0.9, 0]}
        maxPolarAngle={Math.PI * 0.55}
        minDistance={0.8}
        maxDistance={7}
        enableDamping
      />
      <Stats className="render-stats" />
    </Canvas>
  );
}
