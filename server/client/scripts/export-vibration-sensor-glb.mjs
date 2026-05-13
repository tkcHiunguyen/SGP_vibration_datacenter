import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUTPUT_PATHS = [
  resolve(__dirname, "../public/models/vibration_sensor.glb"),
  resolve(__dirname, "../../public/app/models/vibration_sensor.glb"),
];

if (typeof globalThis.self === "undefined") {
  globalThis.self = globalThis;
}

if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class NodeFileReader {
    result = null;
    error = null;
    onloadend = null;
    onerror = null;

    async readAsArrayBuffer(blob) {
      try {
        this.result = await blob.arrayBuffer();
        this.onloadend?.();
      } catch (error) {
        this.error = error;
        this.onerror?.(error);
      }
    }
  };
}

function mesh(geometry, material, name, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const object = new THREE.Mesh(geometry, material);
  object.name = name;
  object.position.set(...position);
  object.rotation.set(...rotation);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function cylinderX(length, radius, material, name, position, radialSegments = 48) {
  return mesh(
    new THREE.CylinderGeometry(radius, radius, length, radialSegments),
    material,
    name,
    position,
    [0, 0, Math.PI / 2],
  );
}

function taperedX(length, radiusStart, radiusEnd, material, name, position, radialSegments = 40) {
  return mesh(
    new THREE.CylinderGeometry(radiusStart, radiusEnd, length, radialSegments),
    material,
    name,
    position,
    [0, 0, Math.PI / 2],
  );
}

function createMaterials() {
  return {
    tip: new THREE.MeshStandardMaterial({
      name: "sensor_tip_gray",
      color: 0xbdc3cb,
      roughness: 0.48,
      metalness: 0.2,
    }),
    body: new THREE.MeshStandardMaterial({
      name: "sensor_body_matte",
      color: 0xd7dde4,
      roughness: 0.56,
      metalness: 0.16,
    }),
    accent: new THREE.MeshPhysicalMaterial({
      name: "sensor_blue_accent",
      color: 0x9dd1ff,
      emissive: 0x69b8ff,
      emissiveIntensity: 0.42,
      roughness: 0.28,
      metalness: 0.08,
      transparent: true,
      opacity: 0.78,
      transmission: 0.34,
      thickness: 0.02,
      clearcoat: 0.2,
    }),
    collar: new THREE.MeshStandardMaterial({
      name: "sensor_rear_collar",
      color: 0x1b2029,
      roughness: 0.4,
      metalness: 0.5,
    }),
    cable: new THREE.MeshStandardMaterial({
      name: "sensor_cable_black",
      color: 0x06090f,
      roughness: 0.85,
      metalness: 0.06,
    }),
  };
}

function createSensorBody(materials) {
  const group = new THREE.Group();
  group.name = "sensor_probe_head";

  group.add(cylinderX(0.11, 0.118, materials.tip, "front_cap", [0.055, 0, 0], 56));
  group.add(cylinderX(0.24, 0.112, materials.body, "main_shell", [0.225, 0, 0], 56));
  group.add(cylinderX(0.1, 0.115, materials.accent, "status_ring_shell", [0.395, 0, 0], 56));
  group.add(cylinderX(0.05, 0.096, materials.collar, "rear_neck", [0.47, 0, 0], 48));

  const statusRing = mesh(
    new THREE.TorusGeometry(0.117, 0.006, 20, 72),
    materials.accent,
    "status_ring_outer_edge",
    [0.395, 0, 0],
    [0, Math.PI / 2, 0],
  );
  group.add(statusRing);

  return group;
}

function createStrainRelief(materials) {
  const group = new THREE.Group();
  group.name = "sensor_strain_relief";

  group.add(taperedX(0.07, 0.091, 0.076, materials.collar, "relief_base", [0.53, 0, 0], 44));

  const ribs = [
    { x: 0.58, length: 0.038, radius: 0.074 },
    { x: 0.62, length: 0.036, radius: 0.068 },
    { x: 0.658, length: 0.034, radius: 0.063 },
    { x: 0.694, length: 0.032, radius: 0.058 },
    { x: 0.728, length: 0.03, radius: 0.054 },
  ];

  ribs.forEach((rib, index) => {
    group.add(cylinderX(rib.length, rib.radius, materials.cable, `relief_rib_${index + 1}`, [rib.x, 0, 0], 40));
  });

  group.add(taperedX(0.06, 0.054, 0.043, materials.cable, "relief_tail", [0.775, 0, 0], 40));

  return group;
}

function createCable(materials) {
  const cableCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.81, 0, 0),
    new THREE.Vector3(1.18, 0.04, 0.11),
    new THREE.Vector3(1.8, 0.24, 0.42),
    new THREE.Vector3(2.52, 0.08, -0.2),
    new THREE.Vector3(3.24, 0.44, -0.58),
    new THREE.Vector3(3.96, 0.14, 0.36),
    new THREE.Vector3(4.72, 0.34, 0.92),
  ]);

  const cable = mesh(
    new THREE.TubeGeometry(cableCurve, 196, 0.026, 16, false),
    materials.cable,
    "sensor_cable",
  );
  const cableBendSleeve = cylinderX(0.16, 0.044, materials.cable, "cable_bend_sleeve", [0.85, 0.004, 0], 32);

  const group = new THREE.Group();
  group.name = "sensor_cable_group";
  group.add(cable);
  group.add(cableBendSleeve);

  return group;
}

function createVibrationSensor() {
  const materials = createMaterials();
  const sensor = new THREE.Group();
  sensor.name = "vibration_sensor_probe";

  sensor.add(createSensorBody(materials));
  sensor.add(createStrainRelief(materials));
  sensor.add(createCable(materials));
  sensor.rotation.y = Math.PI;

  sensor.updateMatrixWorld(true);
  return sensor;
}

function exportGlb(object) {
  const exporter = new GLTFExporter();
  return new Promise((resolveExport, rejectExport) => {
    exporter.parse(
      object,
      (result) => resolveExport(Buffer.from(result)),
      (error) => rejectExport(error),
      {
        binary: true,
        onlyVisible: true,
        includeCustomExtensions: false,
      },
    );
  });
}

const sensor = createVibrationSensor();
const glb = await exportGlb(sensor);

await Promise.all(
  OUTPUT_PATHS.map(async (outputPath) => {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, glb);
    console.log(`Wrote ${outputPath}`);
  }),
);
