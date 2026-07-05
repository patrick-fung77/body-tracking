import { useRef, useState } from "react";
import { usePoseTracker } from "./pose/usePoseTracker";
import { PoseOverlay2D } from "./overlay/PoseOverlay2D";
import { Retargeter } from "./rig/retarget";
import { Scene3D, type ViewMode } from "./scene/Scene3D";
import { HUD } from "./ui/HUD";
import type { LayerVisibility } from "./rig/AnatomySegments";
import "./App.css";

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { status, detail } = usePoseTracker(videoRef);

  const retargeterRef = useRef<Retargeter | null>(null);
  retargeterRef.current ??= new Retargeter();
  const retargeter = retargeterRef.current;

  const [view, setView] = useState<ViewMode>("skeleton3d");
  const [layers, setLayers] = useState<LayerVisibility>({
    skin: true,
    muscle: true,
    skeleton: true,
  });
  const [mirror, setMirror] = useState(false);
  const [showAxes, setShowAxes] = useState(false);

  const handleMirror = (m: boolean) => {
    setMirror(m);
    retargeter.mirror = m;
    retargeter.reset(); // snap to the flipped pose instead of gliding across
  };

  return (
    <div className="app">
      <div className="scene-root">
        <Scene3D
          retargeter={retargeter}
          view={view}
          layers={layers}
          showAxes={showAxes}
        />
      </div>
      <PoseOverlay2D videoRef={videoRef} />
      <HUD
        status={status}
        statusDetail={detail}
        view={view}
        onViewChange={setView}
        layers={layers}
        onLayersChange={setLayers}
        mirror={mirror}
        onMirrorChange={handleMirror}
        showAxes={showAxes}
        onShowAxesChange={setShowAxes}
      />
    </div>
  );
}
