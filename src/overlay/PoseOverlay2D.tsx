import { useEffect, useRef, type RefObject } from "react";
import { PoseLandmarker } from "@mediapipe/tasks-vision";
import { poseStore } from "../pose/poseStore";

/**
 * Phase 1: the raw webcam feed with the 33 landmarks + connectors drawn on a
 * canvas overlay. Runs its own draw loop reading poseStore, so it never
 * blocks (or is blocked by) inference or the 3D scene.
 * Displayed mirrored (scaleX(-1)) like a bathroom mirror.
 */
export function PoseOverlay2D({
  videoRef,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let rafId = 0;
    const draw = () => {
      rafId = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      if (video.videoWidth === 0) return;
      if (
        canvas.width !== video.videoWidth ||
        canvas.height !== video.videoHeight
      ) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const lms = poseStore.frame.imageLandmarks;
      if (!lms) return;

      ctx.strokeStyle = "rgba(80, 255, 120, 0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
        const a = lms[start];
        const b = lms[end];
        if (!a || !b) continue;
        ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
        ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
      }
      ctx.stroke();

      ctx.fillStyle = "rgba(255, 70, 70, 0.95)";
      for (const lm of lms) {
        ctx.beginPath();
        ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [videoRef]);

  return (
    <div className="pose-overlay">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} />
    </div>
  );
}
