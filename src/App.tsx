import { useRef, useState } from "react";
import { usePoseTracker } from "./pose/usePoseTracker";
import { PoseOverlay2D } from "./overlay/PoseOverlay2D";
import { Retargeter } from "./rig/retarget";
import { Scene3D, type PrimitiveView } from "./scene/Scene3D";
import { HUD, type ModelOption } from "./ui/HUD";
import {
  FEMALE_SKELETON,
  PINK_CHARACTER,
  MECHA_WARRIOR,
  IMPORT_HEIGHT,
  type RigModelConfig,
} from "./rig/RigModel";
import type { LayerVisibility } from "./rig/AnatomySegments";
import "./App.css";

const BUILTIN_MODELS: Record<string, RigModelConfig> = {
  skeleton3d: FEMALE_SKELETON,
  pink: PINK_CHARACTER,
  mecha: MECHA_WARRIOR,
};

interface ImportedModel {
  id: string;
  config: RigModelConfig;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { status, detail } = usePoseTracker(videoRef);

  const retargeterRef = useRef<Retargeter | null>(null);
  retargeterRef.current ??= new Retargeter();
  const retargeter = retargeterRef.current;

  const [view, setView] = useState("skeleton3d");
  const [imported, setImported] = useState<ImportedModel[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerVisibility>({
    skin: true,
    muscle: true,
    skeleton: true,
  });
  const [mirror, setMirror] = useState(false);
  const [showAxes, setShowAxes] = useState(false);

  const rigConfig =
    BUILTIN_MODELS[view] ??
    imported.find((m) => m.id === view)?.config ??
    null;
  const primitiveView: PrimitiveView | null =
    view === "anatomy" || view === "stick" ? view : null;

  const modelOptions: ModelOption[] = [
    ...Object.entries(BUILTIN_MODELS).map(([id, c]) => ({
      id,
      label: c.name,
    })),
    ...imported.map((m) => ({ id: m.id, label: `${m.config.name} (imported)` })),
    { id: "anatomy", label: "Anatomy (layers)" },
    { id: "stick", label: "Stick figure" },
  ];

  const handleViewChange = (v: string) => {
    setModelError(null);
    setView(v);
  };

  const handleImport = (file: File) => {
    const url = URL.createObjectURL(file);
    const id = `imported-${Date.now()}`;
    const name = file.name.replace(/\.(glb|gltf)$/i, "");
    setImported((prev) => [
      ...prev,
      { id, config: { name, url, height: IMPORT_HEIGHT } },
    ]);
    setModelError(null);
    setView(id);
  };

  const handleModelError = (message: string) => {
    const friendly = /unexpected token|json|could not load|invalid|parse/i.test(
      message,
    )
      ? "the file doesn't look like a valid GLB model"
      : message;
    setModelError(`Couldn't use that model: ${friendly}`);
    setView("skeleton3d");
  };

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
          rigConfig={rigConfig}
          primitiveView={primitiveView}
          layers={layers}
          showAxes={showAxes}
          onModelError={handleModelError}
        />
      </div>
      <PoseOverlay2D videoRef={videoRef} />
      <HUD
        status={status}
        statusDetail={detail}
        view={view}
        modelOptions={modelOptions}
        onViewChange={handleViewChange}
        onImport={handleImport}
        modelError={modelError}
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
