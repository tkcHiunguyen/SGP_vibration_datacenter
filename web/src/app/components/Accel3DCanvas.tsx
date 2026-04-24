import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ViewportGizmo } from "three-viewport-gizmo";

const VIBRATION_AXIS_SHORT_LABELS = {
  ax: "RH",
  ay: "A",
  az: "RV",
} as const;

/* ── 3D Canvas (Three.js) ── */
export type Accel3DPoint = {
  ts: number;
  ax: number;
  ay: number;
  az: number;
};

export function Accel3DCanvas({ C, accelPoints, height = 150 }: { C: any; accelPoints: Accel3DPoint[]; height?: number }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<(() => void) | null>(null);
  const trajectoryLineRef = useRef<THREE.Line | null>(null);
  const latestPointRef = useRef<THREE.Mesh | null>(null);
  const cubeRef = useRef<THREE.Mesh | null>(null);
  const cubeEdgesRef = useRef<THREE.LineSegments | null>(null);
  const [timeWindowSec, setTimeWindowSec] = useState(20);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b1e42");

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
    camera.position.set(6, 4.8, 6);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xb7d1ff, 0.95);
    directional.position.set(5, 8, 4);
    scene.add(directional);

    const world = new THREE.Group();
    scene.add(world);

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshStandardMaterial({
        color: 0x163a78,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.42,
        roughness: 0.95,
        metalness: 0.05,
      }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.01;
    world.add(plane);

    const grid = new THREE.GridHelper(12, 12, 0x66a3ff, 0x2f5eae);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.95;
    world.add(grid);

    const axes = new THREE.AxesHelper(9.6);
    const axesMaterials = Array.isArray(axes.material) ? axes.material : [axes.material];
    for (const material of axesMaterials) {
      material.depthTest = false;
      material.depthWrite = false;
      material.transparent = false;
      material.toneMapped = false;
    }
    axes.renderOrder = 999;
    axes.position.set(0, 0.03, 0);
    world.add(axes);

    const axisOverlay = new THREE.Group();
    axisOverlay.renderOrder = 1000;
    axisOverlay.position.set(0, 0.03, 0);
    world.add(axisOverlay);

    const axisLength = 3.4;
    const headLength = 0.55;
    const headWidth = 0.24;
    const xArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), axisLength, 0xef4444, headLength, headWidth);
    const yArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), axisLength, 0x22c55e, headLength, headWidth);
    const zArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), axisLength, 0x3b82f6, headLength, headWidth);
    const arrows = [xArrow, yArrow, zArrow];
    for (const arrow of arrows) {
      const lineMat = arrow.line.material as THREE.LineBasicMaterial;
      lineMat.depthTest = false;
      lineMat.depthWrite = false;
      lineMat.toneMapped = false;
      const coneMat = arrow.cone.material as THREE.MeshBasicMaterial;
      coneMat.depthTest = false;
      coneMat.depthWrite = false;
      coneMat.toneMapped = false;
      arrow.renderOrder = 1000;
      axisOverlay.add(arrow);
    }

    const makeAxisLabel = (text: string, color: string) => {
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return new THREE.Object3D();
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = "rgba(2,6,23,0.72)";
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "700 64px Inter, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, size / 2, size / 2 + 2);
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      material.toneMapped = false;
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(0.58, 0.58, 0.58);
      sprite.renderOrder = 1001;
      return sprite;
    };

    const xLabel = makeAxisLabel(VIBRATION_AXIS_SHORT_LABELS.ax, "#ef4444");
    const yLabel = makeAxisLabel(VIBRATION_AXIS_SHORT_LABELS.ay, "#22c55e");
    const zLabel = makeAxisLabel(VIBRATION_AXIS_SHORT_LABELS.az, "#3b82f6");
    xLabel.position.set(axisLength + 0.42, 0, 0);
    yLabel.position.set(0, axisLength + 0.42, 0);
    zLabel.position.set(0, 0, axisLength + 0.42);
    axisOverlay.add(xLabel);
    axisOverlay.add(yLabel);
    axisOverlay.add(zLabel);

    const origin = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    origin.position.set(0, 0.06, 0);
    world.add(origin);

    // Debug reference cube: centered exactly at world origin (0, 0, 0)
    const originCube = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 1.05, 1.05),
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.35,
        roughness: 0.45,
        metalness: 0.12,
      }),
    );
    originCube.position.set(0, 0, 0);
    world.add(originCube);
    cubeRef.current = originCube;

    const originCubeEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.05, 1.05, 1.05)),
      new THREE.LineBasicMaterial({ color: 0xfbbf24 }),
    );
    originCubeEdges.position.set(0, 0, 0);
    world.add(originCubeEdges);
    cubeEdgesRef.current = originCubeEdges;

    const trajectoryGeometry = new THREE.BufferGeometry();
    trajectoryGeometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    trajectoryGeometry.setAttribute("color", new THREE.Float32BufferAttribute([], 3));
    const trajectoryLine = new THREE.Line(
      trajectoryGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
      }),
    );
    world.add(trajectoryLine);
    trajectoryLineRef.current = trajectoryLine;

    const latestPoint = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xfde047 }),
    );
    latestPoint.position.set(0, 0, 0);
    world.add(latestPoint);
    latestPointRef.current = latestPoint;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.minDistance = 4;
    controls.maxDistance = 22;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.screenSpacePanning = true;

    const gizmo = new ViewportGizmo(camera, renderer, {
      container: mount.parentElement ?? mount,
      type: "rounded-cube",
      size: 72,
      placement: "bottom-right",
      offset: { right: 10, bottom: 8 },
      animated: true,
      speed: 1.2,
      background: {
        color: 0xffffff,
        opacity: 1,
        hover: { color: 0xf8fafc, opacity: 1 },
      },
      corners: {
        color: 0xffffff,
        opacity: 1,
      },
      edges: {
        color: 0xf1f5f9,
        opacity: 1,
      },
      x: { color: 0xef4444, label: VIBRATION_AXIS_SHORT_LABELS.ax, labelColor: 0x111827 },
      y: { color: 0x22c55e, label: VIBRATION_AXIS_SHORT_LABELS.ay, labelColor: 0x111827 },
      z: { color: 0x3b82f6, label: VIBRATION_AXIS_SHORT_LABELS.az, labelColor: 0x111827 },
      nx: { color: 0xfca5a5, label: `-${VIBRATION_AXIS_SHORT_LABELS.ax}`, labelColor: 0x111827 },
      ny: { color: 0x86efac, label: `-${VIBRATION_AXIS_SHORT_LABELS.ay}`, labelColor: 0x111827 },
      nz: { color: 0x93c5fd, label: `-${VIBRATION_AXIS_SHORT_LABELS.az}`, labelColor: 0x111827 },
    });
    gizmo.attachControls(controls);
    const centerSceneView = () => {
      controls.target.set(0, 0, 0);
      camera.position.set(6, 4.8, 6);
      camera.lookAt(0, 0, 0);
      controls.update();
    };
    resetViewRef.current = centerSceneView;
    centerSceneView();

    const resize = () => {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      centerSceneView();
      gizmo.update();
    };
    resize();
    // Ensure stable centering after modal/layout transitions settle.
    const settleFrame1 = window.requestAnimationFrame(() => resize());
    const settleFrame2 = window.setTimeout(() => resize(), 80);
    const settleFrame3 = window.setTimeout(() => resize(), 240);

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    let raf = 0;
    const animate = () => {
      raf = window.requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
      gizmo.render();
    };
    animate();

    return () => {
      window.cancelAnimationFrame(raf);
      window.cancelAnimationFrame(settleFrame1);
      window.clearTimeout(settleFrame2);
      window.clearTimeout(settleFrame3);
      resizeObserver.disconnect();
      gizmo.detachControls();
      gizmo.dispose();
      controls.dispose();
      scene.clear();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
      resetViewRef.current = null;
      trajectoryLineRef.current = null;
      latestPointRef.current = null;
      cubeRef.current = null;
      cubeEdgesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const line = trajectoryLineRef.current;
    const latestPoint = latestPointRef.current;
    const cube = cubeRef.current;
    const cubeEdges = cubeEdgesRef.current;
    if (!line || !latestPoint || !cube || !cubeEdges) {
      return;
    }

    const sortedPoints = accelPoints
      .filter((item) =>
        Number.isFinite(item.ts) &&
        Number.isFinite(item.ax) &&
        Number.isFinite(item.ay) &&
        Number.isFinite(item.az),
      )
      .sort((a, b) => a.ts - b.ts);

    if (sortedPoints.length === 0) {
      const geometry = line.geometry as THREE.BufferGeometry;
      geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute([], 3));
      geometry.computeBoundingSphere();
      latestPoint.visible = false;
      cube.position.set(0, 0, 0);
      cubeEdges.position.set(0, 0, 0);
      return;
    }

    const latestTs = sortedPoints[sortedPoints.length - 1].ts;
    const windowStart = latestTs - timeWindowSec * 1000;

    let points = sortedPoints.filter((item) => item.ts >= windowStart);
    if (points.length < 2) {
      points = sortedPoints.slice(-Math.min(20, sortedPoints.length));
    }

    const MAX_POINTS = 140;
    if (points.length > MAX_POINTS) {
      const sampled: Accel3DPoint[] = [];
      for (let i = 0; i < MAX_POINTS; i += 1) {
        const idx = Math.round((i / (MAX_POINTS - 1)) * (points.length - 1));
        sampled.push(points[idx]);
      }
      points = sampled;
    }

    if (points.length === 0) {
      const geometry = line.geometry as THREE.BufferGeometry;
      geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute([], 3));
      geometry.computeBoundingSphere();
      latestPoint.visible = false;
      cube.position.set(0, 0, 0);
      cubeEdges.position.set(0, 0, 0);
      return;
    }

    const smooth = points.map((item, index) => {
      const prev = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      return {
        ...item,
        ax: (prev.ax + item.ax + next.ax) / 3,
        ay: (prev.ay + item.ay + next.ay) / 3,
        az: (prev.az + item.az + next.az) / 3,
      };
    });

    const meanX = smooth.reduce((sum, item) => sum + item.ax, 0) / smooth.length;
    const meanY = smooth.reduce((sum, item) => sum + item.ay, 0) / smooth.length;
    const meanZ = smooth.reduce((sum, item) => sum + item.az, 0) / smooth.length;

    let maxAbs = 0;
    for (const item of smooth) {
      maxAbs = Math.max(
        maxAbs,
        Math.abs(item.ax - meanX),
        Math.abs(item.ay - meanY),
        Math.abs(item.az - meanZ),
      );
    }
    const scale = maxAbs > 0 ? 2.8 / maxAbs : 1;

    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);

    const mapPoint = (item: Accel3DPoint) => ({
      x: (item.ax - meanX) * scale,
      y: (item.az - meanZ) * scale,
      z: (item.ay - meanY) * scale,
    });

    smooth.forEach((item, index) => {
      const p = mapPoint(item);
      const offset = index * 3;
      positions[offset] = p.x;
      positions[offset + 1] = p.y;
      positions[offset + 2] = p.z;

      const t = smooth.length <= 1 ? 1 : index / (smooth.length - 1);
      const start = new THREE.Color("#22d3ee");
      const end = new THREE.Color("#facc15");
      const color = start.lerp(end, t);
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    });

    // Highlight missing-data intervals in trajectory by painting those segments red.
    const diffsMs: number[] = [];
    for (let index = 1; index < smooth.length; index += 1) {
      const diff = smooth[index].ts - smooth[index - 1].ts;
      if (Number.isFinite(diff) && diff > 0) {
        diffsMs.push(diff);
      }
    }
    if (diffsMs.length > 0) {
      const sortedDiffs = [...diffsMs].sort((a, b) => a - b);
      const medianDiff = sortedDiffs[Math.floor(sortedDiffs.length / 2)];
      const gapThresholdMs = Math.max(2000, medianDiff * 2.5);
      const gapColor = new THREE.Color("#fb7185");

      for (let index = 1; index < smooth.length; index += 1) {
        const diff = smooth[index].ts - smooth[index - 1].ts;
        if (diff > gapThresholdMs) {
          const currentOffset = index * 3;
          const previousOffset = (index - 1) * 3;
          colors[currentOffset] = gapColor.r;
          colors[currentOffset + 1] = gapColor.g;
          colors[currentOffset + 2] = gapColor.b;
          colors[previousOffset] = gapColor.r;
          colors[previousOffset + 1] = gapColor.g;
          colors[previousOffset + 2] = gapColor.b;
        }
      }
    }

    const geometry = line.geometry as THREE.BufferGeometry;
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    const latest = mapPoint(smooth[smooth.length - 1]);
    latestPoint.visible = true;
    latestPoint.position.set(latest.x, latest.y, latest.z);
    cube.position.copy(latestPoint.position);
    cubeEdges.position.copy(latestPoint.position);
  }, [accelPoints, timeWindowSec]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        borderRadius: 10,
        border: `1px solid ${C.cardBorder}`,
        overflow: "hidden",
      }}
    >
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
      <button
        type="button"
        onClick={() => resetViewRef.current?.()}
        style={{
          position: "absolute",
          right: 10,
          top: 8,
          borderRadius: 6,
          border: `1px solid ${C.border}`,
          background: "rgba(2, 6, 23, 0.42)",
          color: C.textMuted,
          fontSize: "0.62rem",
          fontWeight: 600,
          padding: "2px 8px",
          cursor: "pointer",
        }}
      >
        Reset View
      </button>
      <div
        style={{
          position: "absolute",
          left: 8,
          top: 8,
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        {[10, 20, 40].map((sec) => {
          const active = sec === timeWindowSec;
          return (
            <button
              key={sec}
              type="button"
              onClick={() => setTimeWindowSec(sec)}
              style={{
                borderRadius: 999,
                border: `1px solid ${active ? C.primary : C.border}`,
                background: active ? "rgba(59,130,246,0.18)" : "rgba(2, 6, 23, 0.42)",
                color: active ? C.textBright : C.textMuted,
                fontSize: "0.62rem",
                fontWeight: 700,
                padding: "2px 8px",
                cursor: "pointer",
              }}
            >
              {sec}s
            </button>
          );
        })}
      </div>
    </div>
  );
}

