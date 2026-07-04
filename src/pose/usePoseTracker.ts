import { useEffect, useState, type RefObject } from "react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { poseStore } from "./poseStore";

// CDN by default; overridable (e.g. in .env.local) for offline dev.
// Keep the wasm version pinned to the installed @mediapipe/tasks-vision version.
const WASM_URL =
  (import.meta.env.VITE_MEDIAPIPE_WASM as string | undefined) ??
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
// pose_landmarker_full per spec; swap "full" for "lite" if the frame rate is bad.
const MODEL_URL =
  (import.meta.env.VITE_MEDIAPIPE_MODEL as string | undefined) ??
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e instanceof Event) return `resource failed to load (${e.type})`;
  return String(e);
}

export type TrackingStatus =
  | "starting-camera"
  | "loading-model"
  | "running"
  | "no-camera"
  | "error";

/**
 * Owns the webcam stream and the PoseLandmarker VIDEO-mode inference loop.
 * Results are published into `poseStore`; only coarse lifecycle status goes
 * through React state.
 */
export function usePoseTracker(videoRef: RefObject<HTMLVideoElement | null>) {
  const [status, setStatus] = useState<TrackingStatus>("starting-camera");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | undefined;
    let landmarker: PoseLandmarker | undefined;

    async function init() {
      const video = videoRef.current;
      if (!video) return;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });
      } catch (e) {
        setStatus("no-camera");
        setDetail(errText(e));
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay rejection (e.g. effect re-run); loop below waits on readyState.
      }

      setStatus("loading-model");
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        const options = {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" as const },
          runningMode: "VIDEO" as const,
          numPoses: 1,
        };
        try {
          landmarker = await PoseLandmarker.createFromOptions(fileset, options);
        } catch {
          landmarker = await PoseLandmarker.createFromOptions(fileset, {
            ...options,
            baseOptions: { ...options.baseOptions, delegate: "CPU" },
          });
        }
      } catch (e) {
        setStatus("error");
        setDetail(errText(e));
        return;
      }
      if (cancelled) {
        landmarker.close();
        return;
      }
      setStatus("running");

      let lastVideoTime = -1;
      let fpsCount = 0;
      let fpsWindowStart = performance.now();

      const loop = () => {
        if (cancelled) return;
        rafId = requestAnimationFrame(loop);
        if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
        lastVideoTime = video.currentTime;

        const now = performance.now();
        let result;
        try {
          result = landmarker!.detectForVideo(video, now);
        } catch (e) {
          cancelAnimationFrame(rafId);
          setStatus("error");
          setDetail(errText(e));
          return;
        }

        fpsCount++;
        if (now - fpsWindowStart >= 500) {
          poseStore.inferenceFps = (fpsCount * 1000) / (now - fpsWindowStart);
          fpsCount = 0;
          fpsWindowStart = now;
        }

        if (result.landmarks.length > 0) {
          poseStore.frame = {
            imageLandmarks: result.landmarks[0],
            worldLandmarks: result.worldLandmarks[0],
            timestampMs: now,
          };
          poseStore.lastDetectionMs = now;
        } else {
          poseStore.frame = {
            imageLandmarks: null,
            worldLandmarks: null,
            timestampMs: now,
          };
        }
      };
      rafId = requestAnimationFrame(loop);
    }

    void init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close();
    };
  }, [videoRef]);

  return { status, detail };
}
