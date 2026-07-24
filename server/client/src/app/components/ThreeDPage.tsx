import { useEffect, useState } from "react";
import { MotorSceneCanvas } from "./MotorSceneCanvas";

export function ThreeDPage() {
  const [panoramaQuality, setPanoramaQuality] = useState<"balanced" | "high">("balanced");

  useEffect(() => {
    document.title = "Mô hình 3D · SGP Vibration Datacenter";
  }, []);

  return (
    <main style={{ position: "relative", width: "100vw", height: "100dvh" }}>
      <h1 className="sr-only">Mô hình thiết bị 3D</h1>
      <MotorSceneCanvas className="motor-scene-canvas--viewport" panoramaQuality={panoramaQuality} />
      <button
        type="button"
        onClick={() => setPanoramaQuality((current) => current === "balanced" ? "high" : "balanced")}
        title="Chất lượng cao tải panorama 8K và dùng thêm băng thông/GPU"
        style={{
          position: "absolute",
          top: "max(16px, env(safe-area-inset-top))",
          right: 16,
          zIndex: 30,
          border: "1px solid rgba(148, 163, 184, 0.45)",
          borderRadius: 8,
          padding: "8px 10px",
          color: "#e2e8f0",
          background: "rgba(15, 23, 42, 0.82)",
          cursor: "pointer",
          fontSize: "0.75rem",
          fontWeight: 700,
        }}
      >
        Panorama: {panoramaQuality === "high" ? "8K" : "4K tối ưu"}
      </button>
    </main>
  );
}
