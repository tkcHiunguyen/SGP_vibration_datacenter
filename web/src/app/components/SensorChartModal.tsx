import React, { useState, useMemo, useRef, useEffect } from "react";
import { X, Thermometer, BarChart3, Activity } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area, ReferenceLine,
} from "recharts";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ViewportGizmo } from "three-viewport-gizmo";
import { DeviceTelemetryPoint, Sensor } from "../data/sensors";
import { useTheme } from "../context/ThemeContext";

const GRAVITY_MS2 = 9.80665;
const ACCEL_LIMIT_MS2 = 8 * GRAVITY_MS2;
const VISIBLE_POINTS = 100;
const MIN_GAP_MS = 2 * 60 * 1000;

function formatChartTime(input: string): string {
  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) {
    return "--:--";
  }
  const d = new Date(parsed);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function formatTickHalfHour(input: number): string {
  if (!Number.isFinite(input)) {
    return "";
  }
  const d = new Date(input);
  const h = d.getHours();
  const m = d.getMinutes();
  if (m === 0) return `${h}h`;
  if (m === 15) return `${h}h15`;
  if (m === 30) return `${h}h30`;
  if (m === 45) return `${h}h45`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function formatTooltipDateTime(input: unknown): string {
  const ts =
    typeof input === "number"
      ? input
      : typeof input === "string"
        ? Date.parse(input)
        : Number.NaN;
  if (!Number.isFinite(ts)) {
    return String(input ?? "");
  }
  const d = new Date(ts);
  return `${formatChartTime(d.toISOString())} · ${d.toLocaleDateString("vi-VN")}`;
}

function buildHalfHourTicks(values: number[]): number[] {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) {
    return [];
  }

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const baseStep = 15 * 60 * 1000;
  const range = Math.max(baseStep, max - min);
  const targetTicks = 6;
  let step = baseStep;
  while (range / step > targetTicks) {
    step *= 2;
  }
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let ts = start; ts <= max; ts += step) {
    ticks.push(ts);
  }

  if (ticks.length === 0) {
    const floorAligned = Math.floor(min / baseStep) * baseStep;
    const ceilAligned = Math.ceil(max / baseStep) * baseStep;
    ticks.push(floorAligned, ceilAligned);
  }

  return ticks;
}

/* ── Generate mock data ── */
function generateTempTrend(sensor: Sensor) {
  const base = sensor.status === "abnormal" ? 62 : 38;
  const noise = sensor.status === "abnormal" ? 12 : 5;
  const now = new Date();
  return Array.from({ length: 60 }, (_, i) => {
    const d = new Date(now.getTime() - (59 - i) * 60000);
    const spike = sensor.status === "abnormal" && Math.abs(i - 45) < 5 ? 15 * (1 - Math.abs(i - 45) / 5) : 0;
    return { ts: d.getTime(), temp: +(base + (Math.random() - 0.5) * noise + spike).toFixed(1) };
  });
}

function generateAccelTrend(sensor: Sensor) {
  const base = sensor.status === "abnormal" ? 0.8 : 0.3;
  const noise = sensor.status === "abnormal" ? 0.5 : 0.15;
  const now = new Date();
  return Array.from({ length: 60 }, (_, i) => {
    const d = new Date(now.getTime() - (59 - i) * 60000);
    const spike = sensor.status === "abnormal" && Math.abs(i - 40) < 4 ? 1.5 * (1 - Math.abs(i - 40) / 4) : 0;
    const axG = (base + (Math.random() - 0.5) * noise + spike) * 1.0;
    const ayG = (base + (Math.random() - 0.5) * noise + spike * 0.7) * 0.8;
    const azG = (base + (Math.random() - 0.5) * noise + spike * 0.5) * 0.6 + 1.0;
    return {
      ts: d.getTime(),
      ax: +(axG * GRAVITY_MS2).toFixed(3),
      ay: +(ayG * GRAVITY_MS2).toFixed(3),
      az: +(azG * GRAVITY_MS2).toFixed(3),
    };
  });
}

function generateFFT(sensor: Sensor, axis: "x" | "y" | "z") {
  const mult = axis === "x" ? 1.0 : axis === "y" ? 0.8 : 0.6;
  const isAbnormal = sensor.status === "abnormal";
  return Array.from({ length: 128 }, (_, i) => {
    const freq = (i * 500) / 128;
    let amp = (Math.random() * 0.05 + 0.01) * mult;
    // Add peaks
    if (Math.abs(freq - 50) < 8) amp += (isAbnormal ? 0.8 : 0.3) * mult * Math.exp(-((freq - 50) ** 2) / 20);
    if (Math.abs(freq - 120) < 10) amp += (isAbnormal ? 0.5 : 0.15) * mult * Math.exp(-((freq - 120) ** 2) / 30);
    if (isAbnormal && Math.abs(freq - 220) < 12) amp += 0.4 * mult * Math.exp(-((freq - 220) ** 2) / 40);
    return { freq: +freq.toFixed(1), amp: +amp.toFixed(4) };
  });
}

/* ── 3D Canvas placeholder (Three.js) ── */
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

    const makeAxisLabel = (text: "X" | "Y" | "Z", color: string) => {
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

    const xLabel = makeAxisLabel("X", "#ef4444");
    const yLabel = makeAxisLabel("Y", "#22c55e");
    const zLabel = makeAxisLabel("Z", "#3b82f6");
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
      x: { color: 0xef4444, label: "X", labelColor: 0x111827 },
      y: { color: 0x22c55e, label: "Y", labelColor: 0x111827 },
      z: { color: 0x3b82f6, label: "Z", labelColor: 0x111827 },
      nx: { color: 0xfca5a5, label: "-X", labelColor: 0x111827 },
      ny: { color: 0x86efac, label: "-Y", labelColor: 0x111827 },
      nz: { color: 0x93c5fd, label: "-Z", labelColor: 0x111827 },
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

/* ── Section wrapper ── */
function ChartSection({ title, icon, children, C }: { title: string; icon: React.ReactNode; children: React.ReactNode; C: any }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ color: C.primary }}>{icon}</span>
        <span style={{ color: C.textBright, fontSize: "0.8rem", fontWeight: 700 }}>{title}</span>
      </div>
      <div style={{
        background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
        padding: "12px 8px 8px",
      }}>
        {children}
      </div>
    </div>
  );
}

/* ── Custom recharts tooltip ── */
function CustomTooltip({ active, payload, label, C }: any) {
  if (!active) return null;
  const rows = (payload || []).filter(
    (p: any) =>
      p &&
      p.name &&
      p.name !== "" &&
      p.dataKey !== "value",
  );
  const hasMissingOnly =
    rows.length === 0 ||
    rows.every((p: any) => p.value === null || p.value === undefined);
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "8px 10px", fontSize: "0.7rem",
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
    }}>
      <div style={{ color: C.textMuted, marginBottom: 4 }}>{formatTooltipDateTime(label)}</div>
      {hasMissingOnly ? (
        <div style={{ color: C.textMuted, fontWeight: 600 }}>Không có dữ liệu</div>
      ) : (
        rows.map((p: any, i: number) => (
          <div key={i} style={{ color: p.color, fontWeight: 600 }}>
            {p.name}: {typeof p.value === "number" ? p.value : "Không có dữ liệu"}
          </div>
        ))
      )}
    </div>
  );
}

function LatestDot({
  cx,
  cy,
  stroke,
  visible,
  label,
  labelDx = -8,
  labelDy = -12,
  labelAnchor = "end",
}: {
  cx?: number;
  cy?: number;
  stroke?: string;
  visible: boolean;
  label?: string;
  labelDx?: number;
  labelDy?: number;
  labelAnchor?: "start" | "middle" | "end";
}) {
  if (!visible || cx === undefined || cy === undefined) {
    return null;
  }
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill={`${stroke ?? "#fff"}22`} />
      <circle cx={cx} cy={cy} r={3.2} fill={stroke ?? "#fff"} stroke="#ffffff" strokeWidth={1.1} />
      {label ? (
        <text
          x={cx + labelDx}
          y={cy + labelDy}
          textAnchor={labelAnchor}
          fill={stroke ?? "#fff"}
          fontSize={10}
          fontWeight={700}
          pointerEvents="none"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

/* ── Main Modal ── */
interface Props {
  sensor: Sensor | null;
  telemetryPoints?: DeviceTelemetryPoint[];
  telemetryLoading?: boolean;
  onClose: () => void;
}

export function SensorChartModal({ sensor, telemetryPoints = [], telemetryLoading = false, onClose }: Props) {
  const { C } = useTheme();
  const [visible, setVisible] = useState(false);
  const [tempHalfSpan, setTempHalfSpan] = useState(5);
  const [accelAmplitudeLimit, setAccelAmplitudeLimit] = useState(ACCEL_LIMIT_MS2);
  const [tempWindowOffset, setTempWindowOffset] = useState(0);
  const [accelWindowOffset, setAccelWindowOffset] = useState(0);
  const [draggingChart, setDraggingChart] = useState<"temp" | "accel" | null>(null);
  const dragStateRef = useRef<{
    chart: "temp" | "accel";
    startX: number;
    startOffset: number;
    width: number;
    maxOffset: number;
  } | null>(null);

  useEffect(() => {
    if (sensor) { const t = setTimeout(() => setVisible(true), 10); return () => clearTimeout(t); }
    else { setVisible(false); }
  }, [sensor]);

  const handleClose = () => { setVisible(false); setTimeout(onClose, 220); };

  const tempData = useMemo(() => {
    if (!sensor) {
      return [];
    }

    const mapped = telemetryPoints
      .filter((point) => typeof point.temperature === "number")
      .map((point) => ({
        ts: Date.parse(point.receivedAt),
        temp: Number((point.temperature as number).toFixed(2)),
      }));

    return mapped.length > 0 ? mapped : generateTempTrend(sensor);
  }, [sensor, telemetryPoints]);

  const tempDomain = useMemo<[number, number]>(() => {
    const values = tempData.map((item) => item.temp).filter((value) => Number.isFinite(value));
    if (values.length === 0) {
      return [15, 35];
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const center = (min + max) / 2;
    return [Number((center - tempHalfSpan).toFixed(2)), Number((center + tempHalfSpan).toFixed(2))];
  }, [tempData, tempHalfSpan]);

  const accelData = useMemo(() => {
    if (!sensor) {
      return [];
    }

    const mapped = telemetryPoints
      .filter(
        (point) =>
          typeof point.ax === "number" ||
          typeof point.ay === "number" ||
          typeof point.az === "number",
      )
      .map((point) => ({
        ts: Date.parse(point.receivedAt),
        ax: Number(((point.ax ?? 0) * GRAVITY_MS2).toFixed(4)),
        ay: Number(((point.ay ?? 0) * GRAVITY_MS2).toFixed(4)),
        az: Number(((point.az ?? 0) * GRAVITY_MS2).toFixed(4)),
      }));

    return mapped.length > 0 ? mapped : generateAccelTrend(sensor);
  }, [sensor, telemetryPoints]);
  const fftX = useMemo(() => sensor ? generateFFT(sensor, "x") : [], [sensor]);
  const fftY = useMemo(() => sensor ? generateFFT(sensor, "y") : [], [sensor]);
  const fftZ = useMemo(() => sensor ? generateFFT(sensor, "z") : [], [sensor]);
  const tempMaxOffset = Math.max(0, tempData.length - VISIBLE_POINTS);
  const accelMaxOffset = Math.max(0, accelData.length - VISIBLE_POINTS);
  const tempEffectiveOffset = Math.min(tempWindowOffset, tempMaxOffset);
  const accelEffectiveOffset = Math.min(accelWindowOffset, accelMaxOffset);
  const tempVisible = useMemo(() => {
    const end = Math.max(0, tempData.length - tempEffectiveOffset);
    const start = Math.max(0, end - VISIBLE_POINTS);
    return tempData.slice(start, end);
  }, [tempData, tempEffectiveOffset]);
  const tempGapThresholdMs = useMemo(() => {
    const diffs: number[] = [];
    for (let index = 1; index < tempData.length; index += 1) {
      const diff = tempData[index].ts - tempData[index - 1].ts;
      if (Number.isFinite(diff) && diff > 0) {
        diffs.push(diff);
      }
    }
    if (diffs.length === 0) {
      return MIN_GAP_MS;
    }
    const sorted = [...diffs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return Math.max(MIN_GAP_MS, median * 2.5);
  }, [tempData]);
  const tempGapRanges = useMemo(() => {
    const ranges: { from: number; to: number; fromTemp: number; toTemp: number }[] = [];
    for (let index = 1; index < tempVisible.length; index += 1) {
      const prev = tempVisible[index - 1];
      const next = tempVisible[index];
      const diff = next.ts - prev.ts;
      if (diff > tempGapThresholdMs) {
        ranges.push({ from: prev.ts, to: next.ts, fromTemp: prev.temp, toTemp: next.temp });
      }
    }
    return ranges;
  }, [tempGapThresholdMs, tempVisible]);
  const tempDisplayData = useMemo(() => {
    const result: Array<{ ts: number; temp: number | null }> = [];
    for (let index = 0; index < tempVisible.length; index += 1) {
      const item = tempVisible[index];
      result.push(item);

      if (index === 0) {
        continue;
      }

      const prev = tempVisible[index - 1];
      const diff = item.ts - prev.ts;
      if (diff <= tempGapThresholdMs) {
        continue;
      }

      const leftTs = prev.ts + 1;
      const rightTs = item.ts - 1;
      const safeLeftTs = Math.min(leftTs, item.ts - 1);
      const safeRightTs = Math.max(rightTs, prev.ts + 1);
      result.splice(result.length - 1, 0, { ts: safeLeftTs, temp: null }, { ts: safeRightTs, temp: null });
    }
    return result.sort((a, b) => a.ts - b.ts);
  }, [tempGapThresholdMs, tempVisible]);
  const accelVisible = useMemo(() => {
    const end = Math.max(0, accelData.length - accelEffectiveOffset);
    const start = Math.max(0, end - VISIBLE_POINTS);
    return accelData.slice(start, end);
  }, [accelData, accelEffectiveOffset]);
  const accelGapThresholdMs = useMemo(() => {
    const diffs: number[] = [];
    for (let index = 1; index < accelData.length; index += 1) {
      const diff = accelData[index].ts - accelData[index - 1].ts;
      if (Number.isFinite(diff) && diff > 0) {
        diffs.push(diff);
      }
    }
    if (diffs.length === 0) {
      return MIN_GAP_MS;
    }
    const sorted = [...diffs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return Math.max(MIN_GAP_MS, median * 2.5);
  }, [accelData]);
  const accelGapRanges = useMemo(() => {
    const ranges: Array<{
      from: number;
      to: number;
      fromAx: number;
      toAx: number;
      fromAy: number;
      toAy: number;
      fromAz: number;
      toAz: number;
    }> = [];
    for (let index = 1; index < accelVisible.length; index += 1) {
      const prev = accelVisible[index - 1];
      const next = accelVisible[index];
      const diff = next.ts - prev.ts;
      if (diff > accelGapThresholdMs) {
        ranges.push({
          from: prev.ts,
          to: next.ts,
          fromAx: prev.ax,
          toAx: next.ax,
          fromAy: prev.ay,
          toAy: next.ay,
          fromAz: prev.az,
          toAz: next.az,
        });
      }
    }
    return ranges;
  }, [accelGapThresholdMs, accelVisible]);
  const accelDisplayData = useMemo(() => {
    const result: Array<{ ts: number; ax: number | null; ay: number | null; az: number | null }> = [];
    for (let index = 0; index < accelVisible.length; index += 1) {
      const item = accelVisible[index];
      result.push(item);

      if (index === 0) {
        continue;
      }

      const prev = accelVisible[index - 1];
      const diff = item.ts - prev.ts;
      if (diff <= accelGapThresholdMs) {
        continue;
      }

      const leftTs = prev.ts + 1;
      const rightTs = item.ts - 1;
      const safeLeftTs = Math.min(leftTs, item.ts - 1);
      const safeRightTs = Math.max(rightTs, prev.ts + 1);

      result.splice(result.length - 1, 0,
        { ts: safeLeftTs, ax: null, ay: null, az: null },
        { ts: safeRightTs, ax: null, ay: null, az: null },
      );
    }
    return result.sort((a, b) => a.ts - b.ts);
  }, [accelGapThresholdMs, accelVisible]);
  const tempTicks = useMemo(() => buildHalfHourTicks(tempVisible.map((item) => item.ts)), [tempVisible]);
  const accelTicks = useMemo(() => buildHalfHourTicks(accelVisible.map((item) => item.ts)), [accelVisible]);
  const showInitialLoading = telemetryLoading && telemetryPoints.length === 0;
  const latestAccel = accelVisible.at(-1);
  useEffect(() => {
    if (tempWindowOffset !== tempEffectiveOffset) {
      setTempWindowOffset(tempEffectiveOffset);
    }
  }, [tempWindowOffset, tempEffectiveOffset]);

  useEffect(() => {
    if (accelWindowOffset !== accelEffectiveOffset) {
      setAccelWindowOffset(accelEffectiveOffset);
    }
  }, [accelWindowOffset, accelEffectiveOffset]);

  useEffect(() => {
    if (!sensor) {
      return;
    }
    setTempHalfSpan(5);
    setAccelAmplitudeLimit(ACCEL_LIMIT_MS2);
    setTempWindowOffset(0);
    setAccelWindowOffset(0);
  }, [sensor?.id]);

  const handleTempWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const zoomOut = event.deltaY > 0;
    setTempHalfSpan((previous) => {
      const next = zoomOut ? previous * 1.1 : previous / 1.1;
      return Math.max(1, Math.min(20, Number(next.toFixed(2))));
    });
  };

  const handleAccelWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const zoomOut = event.deltaY > 0;
    setAccelAmplitudeLimit((previous) => {
      const next = zoomOut ? previous * 1.1 : previous / 1.1;
      const min = 0.5 * GRAVITY_MS2;
      const max = 16 * GRAVITY_MS2;
      return Math.max(min, Math.min(max, Number(next.toFixed(3))));
    });
  };

  useEffect(() => {
    if (!draggingChart) {
      return;
    }

    const handleMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }
      const width = dragState.width;
      const pointsRange = Math.max(1, dragState.maxOffset);
      const pointsPerPixel = pointsRange / Math.max(1, width);
      const deltaX = event.clientX - dragState.startX;
      const rawOffset = dragState.startOffset + Math.round(deltaX * pointsPerPixel);
      const nextOffset = Math.max(0, Math.min(dragState.maxOffset, rawOffset));
      if (dragState.chart === "temp") {
        setTempWindowOffset(nextOffset);
      } else {
        setAccelWindowOffset(nextOffset);
      }
    };

    const handleUp = () => {
      setDraggingChart(null);
      dragStateRef.current = null;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [draggingChart]);

  const handleStartDrag = (
    chart: "temp" | "accel",
    event: React.MouseEvent<HTMLDivElement>,
    currentOffset: number,
    maxOffset: number,
  ) => {
    if (maxOffset <= 0) {
      return;
    }
    dragStateRef.current = {
      chart,
      startX: event.clientX,
      startOffset: currentOffset,
      width: event.currentTarget.clientWidth || 1,
      maxOffset,
    };
    setDraggingChart(chart);
  };

  if (!sensor) return null;

  const chartTextStyle = { fill: C.textMuted, fontSize: 10 };
  const gridColor = C.border + "44";

  return (
    <>
      <div onClick={handleClose} style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        opacity: visible ? 1 : 0, transition: "opacity 0.22s ease",
      }} />

      <div style={{
        position: "fixed", top: "50%", left: "50%", zIndex: 61,
        transform: visible ? "translate(-50%,-53%) scale(1)" : "translate(-50%,-51%) scale(0.97)",
        opacity: visible ? 1 : 0,
        transition: "transform 0.22s cubic-bezier(0.32,0.72,0,1), opacity 0.22s ease",
        width: "min(97vw, 1300px)", maxHeight: "95vh",
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
        boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          background: C.card, borderBottom: `1px solid ${C.border}`,
          padding: "14px 18px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ color: C.textMuted, fontSize: "0.58rem", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 3 }}>
              Phân tích dữ liệu cảm biến
            </div>
            <div style={{ color: C.textBright, fontSize: "0.93rem", fontWeight: 700 }}>
              {sensor.name} <span style={{ color: C.textMuted, fontWeight: 400, fontSize: "0.75rem" }}>({sensor.id})</span>
            </div>
          </div>

          {/* X close button – prominent */}
          <button
            onClick={handleClose}
            title="Đóng"
            style={{
              width: 34, height: 34, borderRadius: 8,
              background: "transparent",
              border: `1px solid ${C.border}`,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              transition: "background 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "#ef444422";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#ef4444";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.borderColor = C.border;
            }}
          >
            <X size={16} color={C.textMuted} strokeWidth={2.5} />
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          <style>{`
            @keyframes chartSpin { to { transform: rotate(360deg); } }
            .chart-pan-area, .chart-pan-area * {
              cursor: ew-resize !important;
              user-select: none !important;
              -webkit-user-select: none !important;
            }
            .chart-pan-area.dragging, .chart-pan-area.dragging * {
              cursor: grabbing !important;
            }
          `}</style>

          {/* Top row: Temperature + Acceleration side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginBottom: 14 }}>

            {/* 1. Temperature trend */}
            <ChartSection title="Xu hướng nhiệt độ (°C)" icon={<Thermometer size={13} strokeWidth={2} />} C={C}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, paddingLeft: 4 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: "0.68rem",
                    fontWeight: 600,
                    background: C.primaryBg,
                    color: C.primary,
                    border: `1px solid ${C.primary + "30"}`,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: C.primary,
                      boxShadow: `0 0 0 2px ${C.primary}22`,
                    }}
                  />
                  Nhiệt độ
                </div>
                {tempGapRanges.length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      borderRadius: 6,
                      fontSize: "0.66rem",
                      fontWeight: 600,
                      background: "rgba(148, 163, 184, 0.08)",
                      color: "#94a3b8",
                      border: "1px solid rgba(148, 163, 184, 0.28)",
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        borderTop: "2px dashed #94a3b8",
                        transform: "translateY(0.5px)",
                      }}
                    />
                    Nét đứt: Không có dữ liệu
                  </div>
                ) : null}
              </div>
              {showInitialLoading ? (
                <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, color: C.textMuted, fontSize: "0.74rem" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.primary, animation: "chartSpin 0.8s linear infinite" }} />
                  <div>Đang tải dữ liệu lịch sử...</div>
                </div>
              ) : (
                <div
                  onMouseDown={(event) => handleStartDrag("temp", event, tempEffectiveOffset, tempMaxOffset)}
                  onWheel={handleTempWheel}
                  className={tempMaxOffset > 0 ? `chart-pan-area${draggingChart === "temp" ? " dragging" : ""}` : ""}
                  style={tempMaxOffset > 0 ? { touchAction: "none" } : { cursor: "default" }}
                >
                  <div style={{ position: "relative" }}>
                    <ResponsiveContainer width="100%" height={150}>
                      <LineChart data={tempDisplayData} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                        <XAxis
                          type="number"
                          dataKey="ts"
                          scale="time"
                          domain={["dataMin", "dataMax"]}
                          ticks={tempTicks}
                          tickFormatter={formatTickHalfHour}
                        tick={chartTextStyle}
                        interval={0}
                      />
                      <YAxis tick={chartTextStyle} domain={tempDomain} width={56} />
                      <Tooltip content={(props: any) => <CustomTooltip {...props} C={C} />} />
                      <Line
                        type="linear"
                        dataKey="temp"
                        name="Nhiệt độ"
                          stroke={C.primary}
                          strokeWidth={2}
                          dot={(dotProps: any) => (
                            <LatestDot
                              cx={dotProps.cx}
                              cy={dotProps.cy}
                              stroke={C.primary}
                              visible={dotProps.index === tempDisplayData.length - 1 && dotProps.value != null}
                              label={typeof dotProps.value === "number" ? `${dotProps.value.toFixed(2)}°C` : undefined}
                              labelDy={-10}
                            />
                        )}
                        isAnimationActive={false}
                      />
                      {tempGapRanges.map((gap, index) => (
                        <ReferenceLine
                          key={`temp-gap-${gap.from}-${gap.to}-${index}`}
                          segment={[
                            { x: gap.from, y: gap.fromTemp },
                            { x: gap.to, y: gap.toTemp },
                          ]}
                          stroke="#cbd5e1"
                          strokeWidth={2}
                          strokeDasharray="6 4"
                          ifOverflow="extendDomain"
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  </div>
                </div>
              )}
            </ChartSection>

            {/* 2. Acceleration trend */}
            <ChartSection
              title="Xu hướng gia tốc (m/s²)"
              icon={<Activity size={13} strokeWidth={2} />}
              C={C}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 8,
                  paddingLeft: 4,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ color: C.textMuted, fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Chế độ 2D
                </div>

                {latestAccel ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                      justifyContent: "flex-end",
                    }}
                  >
                    <div
                      style={{
                        padding: "3px 8px",
                        borderRadius: 999,
                        border: "1px solid #f8717144",
                        background: "#f8717112",
                        color: "#f87171",
                        fontWeight: 700,
                        fontSize: "0.68rem",
                      }}
                    >
                      Ax: {typeof latestAccel.ax === "number" ? latestAccel.ax.toFixed(2) : "--"}
                    </div>
                    <div
                      style={{
                        padding: "3px 8px",
                        borderRadius: 999,
                        border: "1px solid #60a5fa44",
                        background: "#60a5fa12",
                        color: "#60a5fa",
                        fontWeight: 700,
                        fontSize: "0.68rem",
                      }}
                    >
                      Ay: {typeof latestAccel.ay === "number" ? latestAccel.ay.toFixed(2) : "--"}
                    </div>
                    <div
                      style={{
                        padding: "3px 8px",
                        borderRadius: 999,
                        border: "1px solid #a78bfa44",
                        background: "#a78bfa12",
                        color: "#a78bfa",
                        fontWeight: 700,
                        fontSize: "0.68rem",
                      }}
                    >
                      Az: {typeof latestAccel.az === "number" ? latestAccel.az.toFixed(2) : "--"}
                    </div>
                  </div>
                ) : null}
                {accelGapRanges.length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      borderRadius: 6,
                      fontSize: "0.66rem",
                      fontWeight: 600,
                      background: "rgba(148, 163, 184, 0.08)",
                      color: "#94a3b8",
                      border: "1px solid rgba(148, 163, 184, 0.28)",
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        borderTop: "2px dashed #94a3b8",
                        transform: "translateY(0.5px)",
                      }}
                    />
                    Nét đứt: Không có dữ liệu
                  </div>
                ) : null}
              </div>

              {showInitialLoading ? (
                <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, color: C.textMuted, fontSize: "0.74rem" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.primary, animation: "chartSpin 0.8s linear infinite" }} />
                  <div>Đang tải dữ liệu lịch sử...</div>
                </div>
              ) : (
                <div
                  onMouseDown={(event) => handleStartDrag("accel", event, accelEffectiveOffset, accelMaxOffset)}
                  onWheel={handleAccelWheel}
                  className={accelMaxOffset > 0 ? `chart-pan-area${draggingChart === "accel" ? " dragging" : ""}` : ""}
                  style={accelMaxOffset > 0 ? { touchAction: "none" } : { cursor: "default" }}
                >
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={accelDisplayData} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis
                        type="number"
                        dataKey="ts"
                        scale="time"
                        domain={["dataMin", "dataMax"]}
                        ticks={accelTicks}
                        tickFormatter={formatTickHalfHour}
                        tick={chartTextStyle}
                        interval={0}
                      />
                      <YAxis tick={chartTextStyle} domain={[-accelAmplitudeLimit, accelAmplitudeLimit]} width={56} />
                      <Tooltip content={(props: any) => <CustomTooltip {...props} C={C} />} />
                      <Legend wrapperStyle={{ fontSize: "0.68rem", color: C.textMuted }} />
                      <Line
                        type="linear"
                        dataKey="ax"
                        name="Ax"
                        stroke="#f87171"
                        strokeWidth={1.8}
                        dot={(dotProps: any) => (
                          <LatestDot
                            cx={dotProps.cx}
                            cy={dotProps.cy}
                            stroke="#f87171"
                            visible={dotProps.index === accelDisplayData.length - 1 && dotProps.value != null}
                          />
                        )}
                        isAnimationActive={false}
                      />
                      <Line
                        type="linear"
                        dataKey="ay"
                        name="Ay"
                        stroke="#60a5fa"
                        strokeWidth={1.8}
                        dot={(dotProps: any) => (
                          <LatestDot
                            cx={dotProps.cx}
                            cy={dotProps.cy}
                            stroke="#60a5fa"
                            visible={dotProps.index === accelDisplayData.length - 1 && dotProps.value != null}
                          />
                        )}
                        isAnimationActive={false}
                      />
                      <Line
                        type="linear"
                        dataKey="az"
                        name="Az"
                        stroke="#a78bfa"
                        strokeWidth={1.8}
                        dot={(dotProps: any) => (
                          <LatestDot
                            cx={dotProps.cx}
                            cy={dotProps.cy}
                            stroke="#a78bfa"
                            visible={dotProps.index === accelDisplayData.length - 1 && dotProps.value != null}
                          />
                        )}
                        isAnimationActive={false}
                      />
                      {accelGapRanges.map((gap, index) => (
                        <ReferenceLine
                          key={`ax-gap-${gap.from}-${gap.to}-${index}`}
                          segment={[
                            { x: gap.from, y: gap.fromAx },
                            { x: gap.to, y: gap.toAx },
                          ]}
                          stroke="#cbd5e1"
                          strokeWidth={1.8}
                          strokeDasharray="6 4"
                          ifOverflow="extendDomain"
                        />
                      ))}
                      {accelGapRanges.map((gap, index) => (
                        <ReferenceLine
                          key={`ay-gap-${gap.from}-${gap.to}-${index}`}
                          segment={[
                            { x: gap.from, y: gap.fromAy },
                            { x: gap.to, y: gap.toAy },
                          ]}
                          stroke="#cbd5e1"
                          strokeWidth={1.8}
                          strokeDasharray="6 4"
                          ifOverflow="extendDomain"
                        />
                      ))}
                      {accelGapRanges.map((gap, index) => (
                        <ReferenceLine
                          key={`az-gap-${gap.from}-${gap.to}-${index}`}
                          segment={[
                            { x: gap.from, y: gap.fromAz },
                            { x: gap.to, y: gap.toAz },
                          ]}
                          stroke="#cbd5e1"
                          strokeWidth={1.8}
                          strokeDasharray="6 4"
                          ifOverflow="extendDomain"
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartSection>
          </div>

          {/* Bottom row: FFT X / Y / Z in one row */}
          <div style={{ marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <span style={{ color: C.primary }}><BarChart3 size={13} strokeWidth={2} /></span>
              <span style={{ color: C.textBright, fontSize: "0.8rem", fontWeight: 700 }}>Phổ tần số FFT</span>
              <span style={{ color: C.textMuted, fontSize: "0.68rem" }}>(Ax / Ay / Az)</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>

              {/* FFT X */}
              <div style={{
                background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
                padding: "10px 6px 6px",
              }}>
                <div style={{ color: "#f87171", fontSize: "0.68rem", fontWeight: 700, marginBottom: 6, paddingLeft: 4 }}>
                  ■ Ax
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={fftX} margin={{ top: 4, right: 8, bottom: 16, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="freq" tick={{ ...chartTextStyle, fontSize: 9 }} tickMargin={8} />
                    <YAxis tick={{ ...chartTextStyle, fontSize: 9 }} />
                    <Tooltip content={(props: any) => <CustomTooltip {...props} C={C} />} />
                    <Area type="monotone" dataKey="amp" name="Biên độ X" stroke="#f87171" fill="#f8717122" strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <div style={{ textAlign: "right", color: C.textMuted, fontSize: "0.58rem", paddingRight: 6, marginTop: -2 }}>Hz</div>
              </div>

              {/* FFT Y */}
              <div style={{
                background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
                padding: "10px 6px 6px",
              }}>
                <div style={{ color: "#60a5fa", fontSize: "0.68rem", fontWeight: 700, marginBottom: 6, paddingLeft: 4 }}>
                  ■ Ay
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={fftY} margin={{ top: 4, right: 8, bottom: 16, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="freq" tick={{ ...chartTextStyle, fontSize: 9 }} tickMargin={8} />
                    <YAxis tick={{ ...chartTextStyle, fontSize: 9 }} />
                    <Tooltip content={(props: any) => <CustomTooltip {...props} C={C} />} />
                    <Area type="monotone" dataKey="amp" name="Biên độ Y" stroke="#60a5fa" fill="#60a5fa22" strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <div style={{ textAlign: "right", color: C.textMuted, fontSize: "0.58rem", paddingRight: 6, marginTop: -2 }}>Hz</div>
              </div>

              {/* FFT Z */}
              <div style={{
                background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
                padding: "10px 6px 6px",
              }}>
                <div style={{ color: "#a78bfa", fontSize: "0.68rem", fontWeight: 700, marginBottom: 6, paddingLeft: 4 }}>
                  ■ Az
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={fftZ} margin={{ top: 4, right: 8, bottom: 16, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="freq" tick={{ ...chartTextStyle, fontSize: 9 }} tickMargin={8} />
                    <YAxis tick={{ ...chartTextStyle, fontSize: 9 }} />
                    <Tooltip content={(props: any) => <CustomTooltip {...props} C={C} />} />
                    <Area type="monotone" dataKey="amp" name="Biên độ Z" stroke="#a78bfa" fill="#a78bfa22" strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <div style={{ textAlign: "right", color: C.textMuted, fontSize: "0.58rem", paddingRight: 6, marginTop: -2 }}>Hz</div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </>
  );
}
