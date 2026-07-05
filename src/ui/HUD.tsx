import { useEffect, useState } from "react";
import { poseStore } from "../pose/poseStore";
import type { TrackingStatus } from "../pose/usePoseTracker";
import type { LayerVisibility } from "../rig/AnatomySegments";
import type { ViewMode } from "../scene/Scene3D";

export interface HudProps {
  status: TrackingStatus;
  statusDetail: string;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  layers: LayerVisibility;
  onLayersChange: (l: LayerVisibility) => void;
  mirror: boolean;
  onMirrorChange: (m: boolean) => void;
  showAxes: boolean;
  onShowAxesChange: (a: boolean) => void;
}

/** Control panel + status banner. Polls poseStore at 2 Hz for FPS/presence. */
export function HUD(props: HudProps) {
  const [poseFps, setPoseFps] = useState(0);
  const [personVisible, setPersonVisible] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setPoseFps(poseStore.inferenceFps);
      setPersonVisible(
        poseStore.lastDetectionMs > 0 &&
          performance.now() - poseStore.lastDetectionMs < 1500,
      );
    }, 500);
    return () => clearInterval(id);
  }, []);

  const banner = bannerText(props.status, props.statusDetail, personVisible);

  return (
    <>
      {banner && <div className="banner">{banner}</div>}

      <div className="panel">
        <div className="panel-title">Anatomy Mirror</div>

        <label className="row">
          Model
          <select
            value={props.view}
            onChange={(e) => props.onViewChange(e.target.value as ViewMode)}
          >
            <option value="skeleton3d">Skeleton (realistic)</option>
            <option value="anatomy">Anatomy (layers)</option>
            <option value="stick">Stick figure</option>
          </select>
        </label>

        {props.view === "anatomy" && (
          <fieldset className="layers">
            <legend>Layers</legend>
            {(["skin", "muscle", "skeleton"] as const).map((key) => (
              <label key={key} className="row">
                <input
                  type="checkbox"
                  checked={props.layers[key]}
                  onChange={(e) =>
                    props.onLayersChange({
                      ...props.layers,
                      [key]: e.target.checked,
                    })
                  }
                />
                {key[0].toUpperCase() + key.slice(1)}
              </label>
            ))}
          </fieldset>
        )}

        <label className="row">
          <input
            type="checkbox"
            checked={props.mirror}
            onChange={(e) => props.onMirrorChange(e.target.checked)}
          />
          Mirror mode
        </label>

        <label className="row">
          <input
            type="checkbox"
            checked={props.showAxes}
            onChange={(e) => props.onShowAxesChange(e.target.checked)}
          />
          Axis helper
        </label>

        <div className="fps">
          Pose: {props.status === "running" ? `${poseFps.toFixed(0)} fps` : "—"}
        </div>
      </div>
    </>
  );
}

function bannerText(
  status: TrackingStatus,
  detail: string,
  personVisible: boolean,
): string | null {
  switch (status) {
    case "starting-camera":
      return "Starting camera…";
    case "loading-model":
      return "Loading pose model…";
    case "no-camera":
      return `Camera unavailable — check permissions. ${detail}`;
    case "error":
      return `Pose tracking failed: ${detail}`;
    case "running":
      return personVisible ? null : "No person detected — step into view.";
  }
}
