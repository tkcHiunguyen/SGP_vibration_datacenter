import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { MOCK_MOTOR_TWINS, type MotorTwin } from "../data/motorTwins";
import { calculateSceneLoadProgress } from "./motorSceneLoading";

const MOTOR_MODEL_URL = `${import.meta.env.BASE_URL}models/electric_motor.glb`;
const MACHINE_TRAIN_MODEL_URL = `${import.meta.env.BASE_URL}models/motor_pump_train.glb`;
const SENSOR_MODEL_URL = `${import.meta.env.BASE_URL}models/vibration_sensor.glb`;
const PANORAMA_URL = `${import.meta.env.BASE_URL}panoramas/university_workshop.jpg`;
const MOTOR_GROUND_Y = 0;
const MOTOR_MODEL_TARGET_SIZE = 3.25;
const MOTOR_COUPLING_X_OFFSET = -2.38;
const MOTOR_SHAFT_TO_COUPLING_Y_OFFSET = 0.467;
const SENSOR_MODEL_SCALE = 0.62;
const SENSOR_MOUNT_POSITION = new THREE.Vector3(0.94, 1.9, 0.34);
const SENSOR_MOUNT_ROTATION = new THREE.Euler(0.12, Math.PI * 0.76, -0.16);

export type MotorPlacementObjectKey = "motor" | "sensor";

type PlacementRotation = {
  x: number;
  y: number;
  z: number;
};

export type PlacementAxisSceneMatch = {
  x: { motorAxis: "x" | "y" | "z"; motor: string; sensor: "X"; hint: string };
  y: { motorAxis: "x" | "y" | "z"; motor: string; sensor: "Y"; hint: string };
  z: { motorAxis: "x" | "y" | "z"; motor: string; sensor: "Z"; hint: string };
};

type MotorSceneCanvasProps = {
  className?: string;
  placementMode?: boolean;
  selectedPlacementObject?: MotorPlacementObjectKey | null;
  placementMotorRotation?: PlacementRotation;
  placementSensorRotation?: PlacementRotation;
  onPlacementSelectionChange?: (object: MotorPlacementObjectKey | null) => void;
  autoPlateMode?: boolean;
  onPlacementRotateStep?: (object: MotorPlacementObjectKey, axis: keyof PlacementRotation, deltaDegrees: number) => void;
  onPlacementRotationChange?: (object: MotorPlacementObjectKey, rotation: PlacementRotation) => void;
  showPlacementSensorAxes?: boolean;
  placementAxisLabels?: { ax?: string; ay?: string; az?: string };
  onPlacementAxisMatchChange?: (match: PlacementAxisSceneMatch) => void;
};

type SceneAsset = "environment" | "motorModel" | "machineTrainModel" | "sensorModel";
type SceneLoadProgress = Record<SceneAsset, number>;

function isWebGLAvailable() {
  try {
    const canvas = document.createElement("canvas");
    const context = window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl"));
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function findHoverTarget(object: THREE.Object3D | null) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData?.hoverSelectable) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function findRotationAxis(object: THREE.Object3D | null): keyof PlacementRotation | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const axis = current.userData?.rotationAxis;
    if (axis === "x" || axis === "y" || axis === "z") {
      return axis;
    }
    current = current.parent;
  }
  return null;
}

function disposeMaterial(material: THREE.Material) {
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value instanceof THREE.Texture) {
      value.dispose();
    }
  }
  material.dispose();
}

function disposeObject(object: THREE.Object3D) {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();

  object.traverse((child) => {
    const renderable = child as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };

    if (renderable.geometry && !disposedGeometries.has(renderable.geometry)) {
      renderable.geometry.dispose();
      disposedGeometries.add(renderable.geometry);
    }

    if (!renderable.material) {
      return;
    }

    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
    materials.forEach((material) => {
      if (disposedMaterials.has(material)) {
        return;
      }
      disposeMaterial(material);
      disposedMaterials.add(material);
    });
  });
}

function fitObjectToScene(object: THREE.Object3D, targetSize: number) {
  object.updateMatrixWorld(true);
  const initialBox = new THREE.Box3().setFromObject(object);
  const initialSize = initialBox.getSize(new THREE.Vector3());
  const largestAxis = Math.max(initialSize.x, initialSize.y, initialSize.z);
  const scale = largestAxis > 0 ? targetSize / largestAxis : 1;
  object.scale.setScalar(scale);

  object.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(object);
  const center = scaledBox.getCenter(new THREE.Vector3());
  object.position.sub(center);

  object.updateMatrixWorld(true);
  const groundedBox = new THREE.Box3().setFromObject(object);
  object.position.y -= groundedBox.min.y;
  object.position.y += MOTOR_GROUND_Y;
}

function groundObjectOnPlate(object: THREE.Object3D, plateTopY = 0.012) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  object.position.y += plateTopY - box.min.y;
  object.updateMatrixWorld(true);
}

function createAxisLabel(text: string, color: string) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = "800 44px Inter, system-ui, sans-serif";
  let width = text.length <= 1 ? 160 : 360;
  if (ctx) {
    ctx.font = font;
    width = Math.max(160, Math.ceil(ctx.measureText(text).width) + 76);
  }
  canvas.width = Math.min(720, width);
  canvas.height = 112;
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.roundRect?.(6, 6, canvas.width - 12, 100, 20);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, 58, canvas.width - 46);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const labelHeight = 0.238;
  sprite.scale.set((canvas.width / canvas.height) * labelHeight, labelHeight, 1);
  sprite.renderOrder = 60;
  return sprite;
}

function createPlacementSensorModel() {
  const group = new THREE.Group();
  group.name = "placement_clean_sensor";

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.58, metalness: 0.05 });
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.64, metalness: 0.04 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.42, metalness: 0.08, emissive: 0x082f49, emissiveIntensity: 0.15 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.36, 48), bodyMaterial);
  body.name = "placement_sensor_white_body";
  body.rotation.z = Math.PI / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const frontCap = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.142, 0.035, 48), capMaterial);
  frontCap.name = "placement_sensor_front_cap";
  frontCap.rotation.z = Math.PI / 2;
  frontCap.position.x = 0.197;
  frontCap.castShadow = true;
  frontCap.receiveShadow = true;
  group.add(frontCap);

  const rearCap = frontCap.clone();
  rearCap.name = "placement_sensor_rear_cap";
  rearCap.position.x = -0.197;
  group.add(rearCap);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.012, 12, 56), accentMaterial);
  ring.name = "placement_sensor_blue_ring";
  ring.rotation.y = Math.PI / 2;
  ring.position.x = -0.08;
  ring.castShadow = true;
  ring.receiveShadow = true;
  group.add(ring);

  return group;
}

function createMotorVibrationAxes(_axisLabels?: { ax?: string; ay?: string; az?: string }) {
  const group = new THREE.Group();
  group.name = "placement_motor_vibration_axes";
  const axes = [
    { key: "y" as const, label: _axisLabels?.ay || "Axial", color: "#dc2626", dir: new THREE.Vector3(0, 0, 1) },
    { key: "x" as const, label: _axisLabels?.ax || "Radial H", color: "#16a34a", dir: new THREE.Vector3(1, 0, 0) },
    { key: "z" as const, label: _axisLabels?.az || "Radial V", color: "#2563eb", dir: new THREE.Vector3(0, 1, 0) },
  ];
  axes.forEach(({ key, label, color, dir }) => {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).getHex(),
      transparent: true,
      opacity: 0.86,
      depthTest: true,
    });
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.35, 18), material);
    rod.name = `placement_motor_axis_${key}`;
    rod.userData.placementMotorAxisKey = key;
    rod.userData.placementMotorAxisLabel = label;
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    rod.renderOrder = 56;
    group.add(rod);

    const positiveLabel = createAxisLabel(label, color);
    positiveLabel.position.copy(dir.clone().multiplyScalar(1.28));
    group.add(positiveLabel);

    const negativeLabel = createAxisLabel(label, color);
    negativeLabel.position.copy(dir.clone().multiplyScalar(-1.28));
    group.add(negativeLabel);
  });
  return group;
}

function createPlacementSensorAxes() {
  const group = new THREE.Group();
  group.name = "placement_sensor_axes";
  group.visible = false;
  const axes = [
    { axis: "X", color: "#dc2626", dir: new THREE.Vector3(1, 0, 0) },
    { axis: "Y", color: "#16a34a", dir: new THREE.Vector3(0, 0, 1) },
    { axis: "Z", color: "#2563eb", dir: new THREE.Vector3(0, 1, 0) },
  ];
  axes.forEach(({ axis, color, dir }) => {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).getHex(),
      transparent: true,
      opacity: 0.8,
      depthTest: true,
    });
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.6, 18), material);
    rod.name = `placement_sensor_axis_${axis}`;
    rod.userData.placementSensorAxisKey = axis.toLowerCase();
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    rod.renderOrder = 58;
    group.add(rod);

    const positiveLabel = createAxisLabel(axis, color);
    positiveLabel.position.copy(dir.clone().multiplyScalar(0.72));
    group.add(positiveLabel);

    const negativeLabel = createAxisLabel(axis, color);
    negativeLabel.position.copy(dir.clone().multiplyScalar(-0.72));
    group.add(negativeLabel);
  });
  return group;
}

function eulerToPlacementRotation(euler: THREE.Euler): PlacementRotation {
  const normalize = (value: number) => ((value % 360) + 360) % 360;
  return {
    x: normalize(THREE.MathUtils.radToDeg(euler.x)),
    y: normalize(THREE.MathUtils.radToDeg(euler.y)),
    z: normalize(THREE.MathUtils.radToDeg(euler.z)),
  };
}

function withHelpersHidden<T>(object: THREE.Object3D, helperNames: string[], fn: () => T) {
  const helpers = helperNames
    .map((name) => object.getObjectByName(name))
    .filter((helper): helper is THREE.Object3D => Boolean(helper));
  const states = helpers.map((helper) => ({ helper, visible: helper.visible }));
  states.forEach(({ helper }) => { helper.visible = false; });
  const result = fn();
  states.forEach(({ helper, visible }) => { helper.visible = visible; });
  return result;
}

function boxExcludingHelpers(object: THREE.Object3D, helperNames: string[]) {
  return withHelpersHidden(object, helperNames, () => new THREE.Box3().setFromObject(object));
}

function groundObjectOnPlateExcludingHelpers(object: THREE.Object3D, helperNames: string[], plateTopY = 0.012) {
  object.updateMatrixWorld(true);
  const box = boxExcludingHelpers(object, helperNames);
  object.position.y += plateTopY - box.min.y;
  object.updateMatrixWorld(true);
}

function centerObjectOnPlateXZ(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.updateMatrixWorld(true);
}

function enableShadows(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!isMesh(child)) {
      return;
    }

    child.castShadow = true;
    child.receiveShadow = true;
  });
}

function prepareMachineTrainMaterials(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!isMesh(child)) {
      return;
    }

    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.roughness = Math.max(material.roughness, 0.34);
        material.envMapIntensity = 0.85;
      }
    });
  });
}

function prepareSensorMaterials(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!isMesh(child)) {
      return;
    }

    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.roughness = Math.max(material.roughness, 0.24);
        material.envMapIntensity = Math.max(material.envMapIntensity, 0.95);
      }
    });
  });
}

function makeGizmoMaterial(color: number, opacity = 0.9) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function orientAlongVector(object: THREE.Object3D, direction: THREE.Vector3) {
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
}

function addRotationHandle(
  group: THREE.Group,
  color: number,
  position: THREE.Vector3,
  tangent: THREE.Vector3,
  axisKey: keyof PlacementRotation,
) {
  const handle = new THREE.Group();
  handle.position.copy(position);
  handle.userData = { interactionGizmo: true, rotationAxis: axisKey };

  const bead = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 18, 12),
    makeGizmoMaterial(color, 0.96),
  );
  bead.renderOrder = 35;
  bead.userData = { interactionGizmo: true, rotationAxis: axisKey };
  handle.add(bead);

  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.055, 0.16, 24),
    makeGizmoMaterial(color, 0.96),
  );
  arrow.position.copy(tangent.clone().normalize().multiplyScalar(0.12));
  orientAlongVector(arrow, tangent);
  arrow.renderOrder = 36;
  arrow.userData = { interactionGizmo: true, rotationAxis: axisKey };
  handle.add(arrow);

  group.add(handle);
}

function createSlicerRotationGizmo() {
  const group = new THREE.Group();
  group.name = "selected_object_slicer_rotation_gizmo";
  group.visible = false;
  group.userData = { interactionGizmo: true };

  const ringGeometry = new THREE.TorusGeometry(1, 0.034, 16, 160);
  const axes = [
    {
      axisKey: "x" as const,
      color: 0xff5f57,
      rotation: new THREE.Euler(0, Math.PI / 2, 0),
      pointAt: (angle: number) => new THREE.Vector3(0, Math.cos(angle), Math.sin(angle)),
      tangentAt: (angle: number) => new THREE.Vector3(0, -Math.sin(angle), Math.cos(angle)),
    },
    {
      axisKey: "y" as const,
      color: 0x35d07f,
      rotation: new THREE.Euler(Math.PI / 2, 0, 0),
      pointAt: (angle: number) => new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)),
      tangentAt: (angle: number) => new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)),
    },
    {
      axisKey: "z" as const,
      color: 0x38bdf8,
      rotation: new THREE.Euler(0, 0, 0),
      pointAt: (angle: number) => new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0),
      tangentAt: (angle: number) => new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0),
    },
  ];

  axes.forEach((axis) => {
    const axisGroup = new THREE.Group();
    axisGroup.userData = { interactionGizmo: true, rotationAxis: axis.axisKey };

    const ring = new THREE.Mesh(ringGeometry, makeGizmoMaterial(axis.color, 0.78));
    ring.rotation.copy(axis.rotation);
    ring.renderOrder = 30;
    ring.userData = { interactionGizmo: true, rotationAxis: axis.axisKey };
    axisGroup.add(ring);

    [Math.PI * 0.17, Math.PI * 1.17].forEach((angle) => {
      addRotationHandle(axisGroup, axis.color, axis.pointAt(angle), axis.tangentAt(angle), axis.axisKey);
    });

    group.add(axisGroup);
  });

  return group;
}

function positionRotationGizmo(gizmo: THREE.Group, target: THREE.Object3D | null, camera: THREE.Camera) {
  if (!target) {
    gizmo.visible = false;
    return;
  }

  target.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(target);
  if (box.isEmpty()) {
    gizmo.visible = false;
    return;
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const cameraDistance = camera.position.distanceTo(center);
  const radius = Math.min(Math.max(size.length() * 0.36, cameraDistance * 0.035, 0.42), 1.65);
  gizmo.position.copy(center);
  target.getWorldQuaternion(gizmo.quaternion);
  gizmo.scale.setScalar(radius);
  gizmo.visible = true;
}

function splitMachineTrainSelectableParts(machineTrain: THREE.Object3D, metadata: Record<string, unknown>) {
  const base = machineTrain.getObjectByName("machine_common_base");
  if (base) {
    base.name = `${machineTrain.name}_base`;
    base.userData = {
      ...base.userData,
      ...metadata,
      partType: "machine-base",
      hoverSelectable: true,
    };
  }

  const driveAssembly = new THREE.Group();
  driveAssembly.name = `${machineTrain.name}_drive_assembly`;
  driveAssembly.userData = {
    ...driveAssembly.userData,
    ...metadata,
    partType: "drive-assembly",
    hoverSelectable: true,
  };

  machineTrain.add(driveAssembly);

  ["drive_shaft_and_flexible_coupling", "pump_bearing_housing", "centrifugal_pump_volute"].forEach((partName) => {
    const part = machineTrain.getObjectByName(partName);
    if (!part || part === driveAssembly) {
      return;
    }
    driveAssembly.attach(part);
  });

  if (driveAssembly.children.length === 0) {
    machineTrain.remove(driveAssembly);
  }
}

function createMotorTwinInstance(
  sourceMotor: THREE.Object3D,
  sourceMachineTrain: THREE.Object3D,
  sourceSensor: THREE.Object3D,
  twin: MotorTwin,
  placementMode = false,
  placementAxisLabels?: { ax?: string; ay?: string; az?: string },
) {
  const instance = new THREE.Group();
  const metadata = {
    motorId: twin.motorId,
    sensorId: twin.sensorId,
    name: twin.name,
  };

  instance.name = `motor_twin_${twin.motorId}`;
  instance.userData = { ...instance.userData, ...metadata };
  instance.position.set(
    placementMode ? 0 : twin.position.x,
    placementMode ? 0 : twin.position.y,
    placementMode ? 0 : twin.position.z,
  );
  instance.rotation.set(
    placementMode ? 0 : twin.rotation?.x ?? 0,
    placementMode ? 0 : twin.rotation?.y ?? 0,
    placementMode ? 0 : twin.rotation?.z ?? 0,
  );

  const model = sourceMotor.clone(true);
  model.name = `${instance.name}_model`;
  model.userData = {
    ...model.userData,
    ...metadata,
    hoverSelectable: true,
    placementObjectKey: "motor",
  };
  if (placementMode) {
    centerObjectOnPlateXZ(model);
    groundObjectOnPlate(model);
    model.add(createMotorVibrationAxes(placementAxisLabels));
  }
  const machineTrain = sourceMachineTrain.clone(true);
  machineTrain.name = `${instance.name}_machine_train`;
  machineTrain.userData = {
    ...machineTrain.userData,
    ...metadata,
    hoverSelectable: false,
  };
  splitMachineTrainSelectableParts(machineTrain, metadata);
  const sensor = placementMode ? createPlacementSensorModel() : sourceSensor.clone(true);
  sensor.name = `${instance.name}_vibration_sensor`;
  if (!placementMode) {
    sensor.scale.setScalar(SENSOR_MODEL_SCALE);
    sensor.position.copy(SENSOR_MOUNT_POSITION);
    sensor.rotation.copy(SENSOR_MOUNT_ROTATION);
  }
  sensor.userData = {
    ...sensor.userData,
    ...metadata,
    hoverSelectable: true,
    placementObjectKey: "sensor",
  };
  if (!placementMode) {
    machineTrain.visible = true;
    instance.add(machineTrain);
  } else {
    sensor.position.x = model.position.x;
    sensor.position.z = model.position.z;
    const motorBox = boxExcludingHelpers(model, ["placement_motor_vibration_axes"]);
    const sensorBodyBox = new THREE.Box3().setFromObject(sensor);
    sensor.position.y += motorBox.max.y + 0.04 - sensorBodyBox.min.y;
    const axes = createPlacementSensorAxes();
    axes.position.set(0, 0, 0);
    sensor.add(axes);
  }
  instance.add(model);
  instance.add(sensor);

  instance.traverse((child) => {
    child.userData = { ...child.userData, ...metadata };
  });

  return instance;
}

export function MotorSceneCanvas({
  className,
  placementMode = false,
  selectedPlacementObject = null,
  placementMotorRotation,
  placementSensorRotation,
  onPlacementSelectionChange,
  autoPlateMode = false,
  onPlacementRotateStep,
  onPlacementRotationChange,
  showPlacementSensorAxes = false,
  placementAxisLabels,
  onPlacementAxisMatchChange,
}: MotorSceneCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [loadingText, setLoadingText] = useState("Đang tải cảnh 3D");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const onPlacementSelectionChangeRef = useRef(onPlacementSelectionChange);
  const onPlacementRotateStepRef = useRef(onPlacementRotateStep);
  const onPlacementRotationChangeRef = useRef(onPlacementRotationChange);
  const onPlacementAxisMatchChangeRef = useRef(onPlacementAxisMatchChange);
  const autoPlateModeRef = useRef(autoPlateMode);
  const showPlacementSensorAxesRef = useRef(showPlacementSensorAxes);
  const selectPlacementObjectRef = useRef<(objectKey: MotorPlacementObjectKey | null) => void>(() => {});
  const applyPlacementRotationRef = useRef<(
    objectKey: MotorPlacementObjectKey,
    rotation: PlacementRotation | undefined,
  ) => void>(() => {});

  useEffect(() => {
    onPlacementSelectionChangeRef.current = onPlacementSelectionChange;
  }, [onPlacementSelectionChange]);

  useEffect(() => {
    onPlacementRotateStepRef.current = onPlacementRotateStep;
  }, [onPlacementRotateStep]);

  useEffect(() => {
    onPlacementRotationChangeRef.current = onPlacementRotationChange;
  }, [onPlacementRotationChange]);

  useEffect(() => {
    onPlacementAxisMatchChangeRef.current = onPlacementAxisMatchChange;
  }, [onPlacementAxisMatchChange]);

  useEffect(() => {
    autoPlateModeRef.current = autoPlateMode;
  }, [autoPlateMode]);

  useEffect(() => {
    showPlacementSensorAxesRef.current = showPlacementSensorAxes;
  }, [showPlacementSensorAxes]);



  useEffect(() => {
    selectPlacementObjectRef.current(selectedPlacementObject);
  }, [selectedPlacementObject]);

  useEffect(() => {
    applyPlacementRotationRef.current("motor", placementMotorRotation);
  }, [placementMotorRotation]);

  useEffect(() => {
    applyPlacementRotationRef.current("sensor", placementSensorRotation);
  }, [placementSensorRotation]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let active = true;
    let panoramaTexture: THREE.Texture | null = null;
    const loadedAssets = new Set<SceneAsset>();
    const assetProgress: SceneLoadProgress = { environment: 0, motorModel: 0, machineTrainModel: 0, sensorModel: 0 };
    setSceneReady(false);
    setLoadingError(null);
    setLoadingText("Đang khởi tạo cảnh 3D");
    setLoadingProgress(0);

    if (!isWebGLAvailable()) {
      setLoadingError("Trình duyệt hoặc GPU đang chặn WebGL. Hãy reload tab hoặc đóng bớt trang 3D rồi thử lại.");
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#080d16");
    scene.backgroundBlurriness = 0;
    scene.backgroundIntensity = 1;

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
    const cameraTarget = new THREE.Vector3(0.05, 1.12, 0);
    const cameraDirection = new THREE.Vector3(6.5, 3.75, 6.8).normalize();
    camera.position.copy(cameraTarget).addScaledVector(cameraDirection, 15.4);
    camera.lookAt(cameraTarget);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        depth: true,
        stencil: false,
        powerPreference: "high-performance",
      });
    } catch (error) {
      console.error("Unable to create WebGL renderer", error);
      setLoadingError("Không tạo được WebGL context. Hãy reload tab hoặc tắt bớt trang dùng GPU rồi thử lại.");
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.dataset.scene = "motor";
    renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      if (active) {
        setSceneReady(false);
        setLoadingError("WebGL context đã bị mất. Hãy reload tab để khởi tạo lại cảnh 3D.");
      }
    });
    mount.appendChild(renderer.domElement);

    const updateLoadingText = (text: string) => {
      if (active) {
        setLoadingText(text);
      }
    };

    const updateAssetProgress = (asset: SceneAsset, progress: number) => {
      if (!active) {
        return;
      }

      assetProgress[asset] = progress;
      setLoadingProgress(calculateSceneLoadProgress(assetProgress));
    };

    const revealSceneWhenReady = () => {
      updateLoadingText("Đang chuẩn bị khung hình");
      renderer.compile(scene, camera);
      renderer.render(scene, camera);
      requestAnimationFrame(() => {
        if (active) {
          setLoadingProgress(100);
          setSceneReady(true);
        }
      });
    };

    const markAssetLoaded = (asset: SceneAsset) => {
      if (!active || loadedAssets.has(asset)) {
        return;
      }

      loadedAssets.add(asset);
      updateAssetProgress(asset, 100);
      if (loadedAssets.size === 4) {
        revealSceneWhenReady();
        return;
      }

      if (!loadedAssets.has("environment")) {
        updateLoadingText("Đang tải môi trường 3D");
      } else if (!loadedAssets.has("motorModel")) {
        updateLoadingText("Đang tải mô hình motor");
      } else if (!loadedAssets.has("machineTrainModel")) {
        updateLoadingText("Đang tải model phụ trợ");
      } else {
        updateLoadingText("Đang tải model cảm biến rung");
      }
    };

    const textureLoader = new THREE.TextureLoader();
    const applyPanoramaTexture = (texture: THREE.Texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      panoramaTexture = texture;
      scene.background = texture;
      scene.environment = texture;
    };
    const loadPanorama = (url: string) => {
      updateLoadingText("Đang tải môi trường 3D");
      textureLoader.load(
        url,
        (texture) => {
          if (!active) {
            texture.dispose();
            return;
          }

          applyPanoramaTexture(texture);
          markAssetLoaded("environment");
        },
        (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            updateAssetProgress("environment", progress);
            updateLoadingText(`Đang tải môi trường 3D ${progress}%`);
          }
        },
        (error) => {
          if (!active) {
            return;
          }
          console.error("Unable to load panorama texture", error);
          setLoadingError("Không tải được ảnh môi trường 3D");
        },
      );
    };
    loadPanorama(PANORAMA_URL);

    const world = new THREE.Group();
    scene.add(world);

    const hemisphere = new THREE.HemisphereLight(0xdbeafe, 0x1f2937, 1.35);
    scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(5.5, 8, 4.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 24;
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x6ee7b7, 0.75);
    rimLight.position.set(-4, 4, -6);
    scene.add(rimLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 18),
      new THREE.MeshStandardMaterial({
        color: 0x6b7280,
        roughness: 0.94,
        metalness: 0.02,
        side: THREE.DoubleSide,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    world.add(floor);

    const grid = new THREE.GridHelper(22, 22, 0x5eead4, 0x334155);
    grid.position.y = 0.012;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.42;
    world.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.minDistance = 4.2;
    controls.maxDistance = 20;
    controls.target.copy(cameraTarget);
    controls.update();

    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const outlinePass = new OutlinePass(new THREE.Vector2(1, 1), scene, camera);
    outlinePass.edgeStrength = 3.2;
    outlinePass.edgeGlow = 0.24;
    outlinePass.edgeThickness = 1.8;
    outlinePass.visibleEdgeColor.set("#f8fafc");
    outlinePass.hiddenEdgeColor.set("#cbd5e1");
    composer.addPass(outlinePass);
    composer.addPass(new OutputPass());

    const rotationGizmo = createSlicerRotationGizmo();
    scene.add(rotationGizmo);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoveredObject: THREE.Object3D | null = null;
    let selectedObject: THREE.Object3D | null = null;
    let gizmoDrag:
      | {
          pointerId: number;
          axis: keyof PlacementRotation;
          objectKey: MotorPlacementObjectKey;
          lastAngle: number;
          totalAngle: number;
          appliedSteps: number;
        }
      | null = null;
    const placementTargets = new Map<MotorPlacementObjectKey, THREE.Object3D>();

    const syncPlacementSensorAxes = () => {
      const sensorTarget = placementTargets.get("sensor");
      const axes = sensorTarget?.getObjectByName("placement_sensor_axes");
      if (axes) {
        axes.visible = placementMode && showPlacementSensorAxesRef.current;
      }
    };

    const emitPlacementAxisMatch = () => {
      if (!placementMode || !onPlacementAxisMatchChangeRef.current) return;
      const motorTarget = placementTargets.get("motor");
      const sensorTarget = placementTargets.get("sensor");
      if (!motorTarget || !sensorTarget) return;
      const worldDirection = (object: THREE.Object3D) => new THREE.Vector3(0, 1, 0).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion())).normalize();
      const motorAxes = (["x", "y", "z"] as const)
        .map((key) => motorTarget.getObjectByName(`placement_motor_axis_${key}`))
        .filter((axis): axis is THREE.Object3D => Boolean(axis))
        .map((axis) => ({
          key: axis.userData.placementMotorAxisKey as "x" | "y" | "z",
          label: String(axis.userData.placementMotorAxisLabel || axis.userData.placementMotorAxisKey || ""),
          dir: worldDirection(axis),
        }));
      const sensorAxes = (["X", "Y", "Z"] as const)
        .map((label) => sensorTarget.getObjectByName(`placement_sensor_axis_${label}`))
        .filter((axis): axis is THREE.Object3D => Boolean(axis))
        .map((axis) => ({
          key: axis.userData.placementSensorAxisKey as "x" | "y" | "z",
          label: axis.name.endsWith("_X") ? "X" as const : axis.name.endsWith("_Y") ? "Y" as const : "Z" as const,
          dir: worldDirection(axis),
        }));
      if (motorAxes.length !== 3 || sensorAxes.length !== 3) return;
      const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
      const score = (candidate: number[]) => candidate.reduce((sum, motorIndex, sensorIndex) => sum + Math.abs(sensorAxes[sensorIndex].dir.dot(motorAxes[motorIndex].dir)), 0);
      const best = permutations.reduce((current, candidate) => score(candidate) > score(current) ? candidate : current, permutations[0]);
      const match = {} as PlacementAxisSceneMatch;
      sensorAxes.forEach((sensorAxis, sensorIndex) => {
        const motorAxis = motorAxes[best[sensorIndex]];
        const value = { motorAxis: motorAxis.key, motor: motorAxis.label, sensor: sensorAxis.label, hint: `song song trục ${sensorAxis.label} cảm biến` };
        if (sensorAxis.key === "x") match.x = value as PlacementAxisSceneMatch["x"];
        if (sensorAxis.key === "y") match.y = value as PlacementAxisSceneMatch["y"];
        if (sensorAxis.key === "z") match.z = value as PlacementAxisSceneMatch["z"];
      });
      onPlacementAxisMatchChangeRef.current(match);
    };

    syncPlacementSensorAxes();

    const syncOutlineSelection = () => {
      const selectedObjects = [hoveredObject, selectedObject]
        .filter((object): object is THREE.Object3D => Boolean(object));
      outlinePass.selectedObjects = Array.from(new Set(selectedObjects));
    };

    const selectPlacementObject = (objectKey: MotorPlacementObjectKey | null) => {
      selectedObject = objectKey ? placementTargets.get(objectKey) ?? null : null;
      positionRotationGizmo(rotationGizmo, placementMode ? null : selectedObject, camera);
      syncOutlineSelection();
    };
    selectPlacementObjectRef.current = selectPlacementObject;

    const applyPlacementRotation = (objectKey: MotorPlacementObjectKey, rotation: PlacementRotation | undefined) => {
      const target = placementTargets.get(objectKey);
      if (!target || !rotation) {
        return;
      }
      target.rotation.set(
        THREE.MathUtils.degToRad(rotation.x),
        THREE.MathUtils.degToRad(rotation.y),
        THREE.MathUtils.degToRad(rotation.z),
      );
      if (objectKey === "motor") {
        groundObjectOnPlateExcludingHelpers(target, ["placement_motor_vibration_axes"]);
        const sensorTarget = placementTargets.get("sensor");
        if (sensorTarget) {
          const motorBox = boxExcludingHelpers(target, ["placement_motor_vibration_axes"]);
          const axes = sensorTarget.getObjectByName("placement_sensor_axes");
          const axesVisible = axes?.visible ?? false;
          if (axes) axes.visible = false;
          const sensorBox = new THREE.Box3().setFromObject(sensorTarget);
          if (axes) axes.visible = axesVisible;
          sensorTarget.position.x = target.position.x;
          sensorTarget.position.z = target.position.z;
          sensorTarget.position.y += motorBox.max.y + 0.04 - sensorBox.min.y;
        }
      } else if (objectKey === "sensor") {
        syncPlacementSensorAxes();
      }
      emitPlacementAxisMatch();
      if (selectedObject === target) {
        positionRotationGizmo(rotationGizmo, placementMode ? null : selectedObject, camera);
        syncOutlineSelection();
      }
    };
    applyPlacementRotationRef.current = applyPlacementRotation;

    const updatePointerFromEvent = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        return false;
      }

      pointer.x = (x / rect.width) * 2 - 1;
      pointer.y = -((y / rect.height) * 2 - 1);
      return true;
    };

    const getPointerAngleAroundGizmo = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const projected = rotationGizmo.position.clone().project(camera);
      const centerX = ((projected.x + 1) / 2) * rect.width + rect.left;
      const centerY = ((-projected.y + 1) / 2) * rect.height + rect.top;
      return Math.atan2(event.clientY - centerY, event.clientX - centerX);
    };

    const updateHoverFromPointer = (event: PointerEvent) => {
      if (gizmoDrag) {
        event.preventDefault();
        event.stopPropagation();
        const currentAngle = getPointerAngleAroundGizmo(event);
        let angleDelta = currentAngle - gizmoDrag.lastAngle;
        if (angleDelta > Math.PI) {
          angleDelta -= Math.PI * 2;
        } else if (angleDelta < -Math.PI) {
          angleDelta += Math.PI * 2;
        }
        gizmoDrag.lastAngle = currentAngle;
        gizmoDrag.totalAngle -= angleDelta;
        const totalSteps = Math.trunc(THREE.MathUtils.radToDeg(gizmoDrag.totalAngle) / 10);
        const deltaSteps = totalSteps - gizmoDrag.appliedSteps;
        if (deltaSteps !== 0) {
          gizmoDrag.appliedSteps = totalSteps;
          onPlacementRotateStepRef.current?.(gizmoDrag.objectKey, gizmoDrag.axis, deltaSteps * 10);
        }
        return;
      }

      if (!updatePointerFromEvent(event)) {
        hoveredObject = null;
        syncOutlineSelection();
        return;
      }

      raycaster.setFromCamera(pointer, camera);

      const intersections = raycaster.intersectObjects(world.children, true);
      const hovered = intersections
        .map((intersection) => findHoverTarget(intersection.object))
        .find((object): object is THREE.Object3D => Boolean(object));
      if (hovered === hoveredObject) {
        return;
      }

      hoveredObject = hovered ?? null;
      syncOutlineSelection();
    };

    const selectObjectFromPointer = (event: PointerEvent) => {
      if (!updatePointerFromEvent(event)) {
        selectedObject = null;
        positionRotationGizmo(rotationGizmo, null, camera);
        syncOutlineSelection();
        if (placementMode) {
          onPlacementSelectionChangeRef.current?.(null);
        }
        return;
      }

      raycaster.setFromCamera(pointer, camera);

      if (placementMode && selectedObject && rotationGizmo.visible) {
        const gizmoHit = raycaster.intersectObjects(rotationGizmo.children, true)
          .map((intersection) => findRotationAxis(intersection.object))
          .find((axis): axis is keyof PlacementRotation => Boolean(axis));
        if (gizmoHit) {
          event.preventDefault();
          event.stopPropagation();
          const objectKey = selectedObject.userData?.placementObjectKey;
          if (objectKey === "motor" || objectKey === "sensor") {
            const startAngle = getPointerAngleAroundGizmo(event);
            gizmoDrag = {
              pointerId: event.pointerId,
              axis: gizmoHit,
              objectKey,
              lastAngle: startAngle,
              totalAngle: 0,
              appliedSteps: 0,
            };
            controls.enabled = false;
            renderer.domElement.setPointerCapture?.(event.pointerId);
          }
          return;
        }
      }

      const intersections = raycaster.intersectObjects(world.children, true);
      const selectedIntersection = intersections.find((intersection) => Boolean(findHoverTarget(intersection.object)));
      const selected = selectedIntersection ? findHoverTarget(selectedIntersection.object) : null;

      if (placementMode && autoPlateModeRef.current && selected && selectedIntersection?.face) {
        const objectKey = selected.userData?.placementObjectKey;
        if (objectKey === "motor" || objectKey === "sensor") {
          event.preventDefault();
          event.stopPropagation();
          selectedObject = selected;
          const normalMatrix = new THREE.Matrix3().getNormalMatrix(selectedIntersection.object.matrixWorld);
          const worldNormal = selectedIntersection.face.normal.clone().applyNormalMatrix(normalMatrix).normalize();
          const alignToPlate = new THREE.Quaternion().setFromUnitVectors(worldNormal, new THREE.Vector3(0, -1, 0));
          selected.quaternion.premultiply(alignToPlate);
          selected.updateMatrixWorld(true);
          groundObjectOnPlate(selected);
          positionRotationGizmo(rotationGizmo, placementMode ? null : selectedObject, camera);
          syncOutlineSelection();
          onPlacementSelectionChangeRef.current?.(objectKey);
          onPlacementRotationChangeRef.current?.(objectKey, eulerToPlacementRotation(selected.rotation));
          return;
        }
      }

      selectedObject = selected ?? null;
      positionRotationGizmo(rotationGizmo, placementMode ? null : selectedObject, camera);
      syncOutlineSelection();
      if (placementMode) {
        const objectKey = selectedObject?.userData?.placementObjectKey;
        const placementObjectKey = objectKey === "motor" || objectKey === "sensor" ? objectKey : null;
        onPlacementSelectionChangeRef.current?.(placementObjectKey);
        if (placementObjectKey) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };

    const finishGizmoDrag = (event: PointerEvent) => {
      if (!gizmoDrag || gizmoDrag.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      gizmoDrag = null;
      controls.enabled = true;
    };

    const clearHover = () => {
      if (gizmoDrag) {
        return;
      }
      hoveredObject = null;
      syncOutlineSelection();
    };

    renderer.domElement.addEventListener("pointermove", updateHoverFromPointer, true);
    renderer.domElement.addEventListener("pointerdown", selectObjectFromPointer, true);
    renderer.domElement.addEventListener("pointerup", finishGizmoDrag, true);
    renderer.domElement.addEventListener("pointercancel", finishGizmoDrag, true);
    renderer.domElement.addEventListener("pointerleave", clearHover);

    const loader = new GLTFLoader();
    let motorTemplate: THREE.Object3D | null = null;
    let machineTrainTemplate: THREE.Object3D | null = null;
    let sensorTemplate: THREE.Object3D | null = null;
    let motorTwinGroupAdded = false;

    const addMotorTwinGroupIfReady = () => {
      if (!motorTemplate || !machineTrainTemplate || !sensorTemplate || motorTwinGroupAdded) {
        return;
      }

      const readyMotorTemplate = motorTemplate;
      const readyMachineTrainTemplate = machineTrainTemplate;
      const readySensorTemplate = sensorTemplate;
      const motorTwinGroup = new THREE.Group();
      motorTwinGroup.name = "motor_twins_from_recorded_positions";
      MOCK_MOTOR_TWINS.forEach((motorTwin) => {
        const motorTwinInstance = createMotorTwinInstance(
          readyMotorTemplate,
          readyMachineTrainTemplate,
          readySensorTemplate,
          motorTwin,
          placementMode,
          placementAxisLabels,
        );
        motorTwinGroup.add(motorTwinInstance);
        if (placementMode) {
          motorTwinInstance.traverse((child) => {
            const objectKey = child.userData?.placementObjectKey;
            if (objectKey === "motor" || objectKey === "sensor") {
              placementTargets.set(objectKey, child);
            }
          });
        }
      });
      world.add(motorTwinGroup);
      if (placementMode) {
        applyPlacementRotation("motor", placementMotorRotation);
        applyPlacementRotation("sensor", placementSensorRotation);
        selectPlacementObject(selectedPlacementObject);
      }
      motorTwinGroupAdded = true;
    };

    updateLoadingText("Đang tải mô hình motor");
    loader.load(
      MOTOR_MODEL_URL,
      (gltf) => {
        if (!active) {
          disposeObject(gltf.scene);
          return;
        }

        motorTemplate = gltf.scene;
        motorTemplate.name = "electric_motor_template";
        enableShadows(motorTemplate);
        fitObjectToScene(motorTemplate, MOTOR_MODEL_TARGET_SIZE);
        motorTemplate.rotation.y = Math.PI / 2;
        motorTemplate.position.x += MOTOR_COUPLING_X_OFFSET;
        motorTemplate.position.y += MOTOR_SHAFT_TO_COUPLING_Y_OFFSET;
        addMotorTwinGroupIfReady();
        markAssetLoaded("motorModel");
      },
      (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          updateAssetProgress("motorModel", progress);
          updateLoadingText(`Đang tải mô hình motor ${progress}%`);
        }
      },
      (error) => {
        console.error("Unable to load original motor model", error);
        if (active) {
          setLoadingError("Không tải được mô hình motor gốc");
        }
      },
    );

    updateLoadingText("Đang tải model phụ trợ");
    loader.load(
      MACHINE_TRAIN_MODEL_URL,
      (gltf) => {
        if (!active) {
          disposeObject(gltf.scene);
          return;
        }

        machineTrainTemplate = gltf.scene;
        machineTrainTemplate.name = "motor_machine_train_template";
        prepareMachineTrainMaterials(machineTrainTemplate);
        addMotorTwinGroupIfReady();
        markAssetLoaded("machineTrainModel");
      },
      (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          updateAssetProgress("machineTrainModel", progress);
          updateLoadingText(`Đang tải model phụ trợ ${progress}%`);
        }
      },
      (error) => {
        console.error("Unable to load motor machine train model", error);
        if (active) {
          setLoadingError("Không tải được model phụ trợ của motor");
        }
      },
    );

    updateLoadingText("Đang tải model cảm biến rung");
    loader.load(
      SENSOR_MODEL_URL,
      (gltf) => {
        if (!active) {
          disposeObject(gltf.scene);
          return;
        }

        sensorTemplate = gltf.scene;
        sensorTemplate.name = "vibration_sensor_template";
        prepareSensorMaterials(sensorTemplate);
        addMotorTwinGroupIfReady();
        markAssetLoaded("sensorModel");
      },
      (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          updateAssetProgress("sensorModel", progress);
          updateLoadingText(`Đang tải model cảm biến rung ${progress}%`);
        }
      },
      (error) => {
        console.error("Unable to load vibration sensor model", error);
        if (active) {
          setLoadingError("Không tải được model cảm biến rung");
        }
      },
    );

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const resolvedHeight = Math.max(1, mount.clientHeight);
      const aspect = width / resolvedHeight;
      const cameraDistance = aspect < 0.75 ? 20.2 : 15.4;
      camera.position.copy(cameraTarget).addScaledVector(cameraDirection, cameraDistance);
      camera.lookAt(cameraTarget);
      controls.target.copy(cameraTarget);
      camera.aspect = width / resolvedHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(width, resolvedHeight);
      composer.setSize(width, resolvedHeight);
      outlinePass.setSize(width, resolvedHeight);
      controls.update();
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    renderer.setAnimationLoop(() => {
      syncPlacementSensorAxes();
      controls.update();
      composer.render();
    });

    return () => {
      active = false;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", updateHoverFromPointer, true);
      renderer.domElement.removeEventListener("pointerdown", selectObjectFromPointer, true);
      renderer.domElement.removeEventListener("pointerup", finishGizmoDrag, true);
      renderer.domElement.removeEventListener("pointercancel", finishGizmoDrag, true);
      renderer.domElement.removeEventListener("pointerleave", clearHover);
      outlinePass.selectedObjects = [];
      composer.dispose();
      controls.dispose();
      scene.background = null;
      scene.environment = null;
      panoramaTexture?.dispose();
      disposeObject(scene);
      scene.clear();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className={["motor-scene-canvas", className].filter(Boolean).join(" ")}
    >
      {(!sceneReady || loadingError) && (
        <div
          role="status"
          aria-live="polite"
          className={[
            "motor-scene-loader",
            "is-visible",
            loadingError ? "has-error" : "",
          ].filter(Boolean).join(" ")}
        >
          <div
            aria-hidden="true"
            className="motor-scene-loader-spinner"
          />
          <div className="motor-scene-loader-text">{loadingError || loadingText}</div>
          <div className="motor-scene-loader-progress" aria-hidden="true">
            <div
              className="motor-scene-loader-progress-value"
              style={{ width: `${loadingError ? 100 : loadingProgress}%` }}
            />
          </div>
          <div className="motor-scene-loader-percent">{loadingError ? "Lỗi tải" : `${loadingProgress}%`}</div>
        </div>
      )}
    </div>
  );
}
