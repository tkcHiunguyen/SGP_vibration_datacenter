import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SHAFT_Y = 1.54;
const OUTPUT_PATHS = [
  resolve(__dirname, "../public/models/motor_pump_train.glb"),
  resolve(__dirname, "../../public/app/models/motor_pump_train.glb"),
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

function roundedBox(width, height, depth, material, name, position, radius = 0.05) {
  return mesh(new RoundedBoxGeometry(width, height, depth, 6, radius), material, name, position);
}

function cylinderX(length, radius, material, name, position, radialSegments = 56) {
  return mesh(
    new THREE.CylinderGeometry(radius, radius, length, radialSegments),
    material,
    name,
    position,
    [0, 0, Math.PI / 2],
  );
}

function cylinderY(height, radius, material, name, position, radialSegments = 56) {
  return mesh(new THREE.CylinderGeometry(radius, radius, height, radialSegments), material, name, position);
}

function torusX(radius, tubeRadius, material, name, position) {
  return mesh(
    new THREE.TorusGeometry(radius, tubeRadius, 20, 96),
    material,
    name,
    position,
    [0, Math.PI / 2, 0],
  );
}

function addTopBolts(group, material, points, namePrefix) {
  points.forEach(([x, y, z], index) => {
    group.add(cylinderY(0.06, 0.045, material, `${namePrefix}_${index + 1}`, [x, y, z], 18));
  });
}

function createMaterials() {
  return {
    baseDeck: new THREE.MeshStandardMaterial({ name: "base_dark_blued_steel", color: 0x162334, roughness: 0.52, metalness: 0.48 }),
    basePlate: new THREE.MeshStandardMaterial({ name: "base_top_brushed_plate", color: 0x24344a, roughness: 0.44, metalness: 0.56 }),
    rail: new THREE.MeshStandardMaterial({ name: "teal_mounting_rails", color: 0x2f7476, roughness: 0.34, metalness: 0.62 }),
    rubber: new THREE.MeshStandardMaterial({ name: "black_rubber_isolators", color: 0x03070d, roughness: 0.92, metalness: 0.02 }),
    bolt: new THREE.MeshStandardMaterial({ name: "polished_anchor_bolts", color: 0xc9d3df, roughness: 0.22, metalness: 0.88 }),
    shaft: new THREE.MeshStandardMaterial({ name: "polished_drive_shaft", color: 0xd1d9e3, roughness: 0.18, metalness: 0.9 }),
    couplingHub: new THREE.MeshStandardMaterial({ name: "machined_coupling_hubs", color: 0x7c8795, roughness: 0.34, metalness: 0.74 }),
    couplingInsert: new THREE.MeshStandardMaterial({ name: "black_elastomer_spider", color: 0x0b0f17, roughness: 0.86, metalness: 0.03 }),
    pumpBody: new THREE.MeshStandardMaterial({ name: "warm_cast_pump_body", color: 0x7f8995, roughness: 0.56, metalness: 0.34 }),
    pumpDark: new THREE.MeshStandardMaterial({ name: "dark_cast_iron_housings", color: 0x3c4652, roughness: 0.66, metalness: 0.32 }),
    pumpRim: new THREE.MeshStandardMaterial({ name: "machined_flange_faces", color: 0xaeb8c4, roughness: 0.32, metalness: 0.72 }),
  };
}

function createMotorBase(materials) {
  const base = new THREE.Group();
  base.name = "machine_common_base";

  base.add(roundedBox(8.6, 0.22, 2.95, materials.baseDeck, "deck", [0, 0.11, 0], 0.08));
  base.add(roundedBox(8.02, 0.12, 2.42, materials.basePlate, "top_plate", [0, 0.28, 0], 0.05));

  [-0.72, 0.72].forEach((z, index) => {
    base.add(roundedBox(7.46, 0.16, 0.22, materials.rail, `alignment_rail_${index + 1}`, [0, 0.42, z], 0.04));
  });

  [
    [-3.18, -0.72], [-1.82, -0.72], [-3.18, 0.72], [-1.82, 0.72],
    [0.62, -0.72], [1.98, -0.72], [0.62, 0.72], [1.98, 0.72],
  ].forEach(([x, z], index) => {
    base.add(roundedBox(0.68, 0.08, 0.38, materials.rubber, `anti_vibration_pad_${index + 1}`, [x, 0.52, z], 0.04));
  });

  addTopBolts(
    base,
    materials.bolt,
    [[-3.92, 0.37, -1.15], [3.92, 0.37, -1.15], [-3.92, 0.37, 1.15], [3.92, 0.37, 1.15]],
    "base_anchor_bolt",
  );

  return base;
}

function createDriveShaftAndCoupling(materials) {
  const group = new THREE.Group();
  group.name = "drive_shaft_and_flexible_coupling";

  group.add(cylinderX(1.68, 0.1, materials.shaft, "pump_input_shaft", [0.22, SHAFT_Y, 0], 56));
  group.add(cylinderX(0.34, 0.3, materials.couplingHub, "coupling_motor_hub", [-0.74, SHAFT_Y, 0], 64));
  group.add(cylinderX(0.18, 0.35, materials.couplingInsert, "coupling_elastomer_spider", [-0.49, SHAFT_Y, 0], 64));
  group.add(cylinderX(0.34, 0.3, materials.couplingHub, "coupling_pump_hub", [-0.24, SHAFT_Y, 0], 64));

  [-0.9, -0.58, -0.39, -0.08].forEach((x, index) => {
    group.add(torusX(0.305, 0.018, index === 1 ? materials.couplingInsert : materials.pumpRim, `coupling_detail_ring_${index + 1}`, [x, SHAFT_Y, 0]));
  });

  return group;
}

function createBearingHousing(materials) {
  const group = new THREE.Group();
  group.name = "pump_bearing_housing";

  group.add(roundedBox(1.22, 0.18, 1.1, materials.pumpDark, "bearing_foot", [0.95, 0.43, 0], 0.06));
  group.add(roundedBox(0.96, 1, 0.82, materials.pumpBody, "bearing_support_body", [0.95, 1.02, 0], 0.08));
  group.add(cylinderX(1.22, 0.38, materials.pumpDark, "bearing_barrel", [0.95, SHAFT_Y, 0], 64));
  group.add(cylinderX(0.14, 0.43, materials.pumpRim, "bearing_front_collar", [1.62, SHAFT_Y, 0], 64));
  group.add(cylinderX(0.14, 0.43, materials.pumpRim, "bearing_rear_collar", [0.28, SHAFT_Y, 0], 64));

  [-0.42, 0.42].forEach((z, index) => {
    group.add(roundedBox(0.12, 0.58, 0.14, materials.pumpDark, `bearing_side_rib_${index + 1}`, [0.95, 0.82, z], 0.025));
  });

  addTopBolts(group, materials.bolt, [[0.54, 0.55, -0.42], [1.36, 0.55, -0.42], [0.54, 0.55, 0.42], [1.36, 0.55, 0.42]], "bearing_foot_bolt");

  return group;
}

function createPumpVolute(materials) {
  const group = new THREE.Group();
  group.name = "centrifugal_pump_volute";

  group.add(cylinderX(0.86, 0.96, materials.pumpBody, "volute_casing", [2.32, SHAFT_Y, 0], 80));
  group.add(torusX(0.82, 0.07, materials.pumpRim, "volute_machined_outer_rim", [1.86, SHAFT_Y, 0]));
  group.add(torusX(0.54, 0.035, materials.pumpDark, "front_cover_inner_lip", [1.69, SHAFT_Y, 0]));
  group.add(cylinderX(0.16, 0.62, materials.pumpDark, "front_cover", [1.76, SHAFT_Y, 0], 72));
  group.add(cylinderX(0.42, 0.34, materials.pumpDark, "suction_neck", [2.93, SHAFT_Y, 0], 64));
  group.add(cylinderX(0.16, 0.48, materials.pumpRim, "suction_flange", [3.22, SHAFT_Y, 0], 64));
  group.add(cylinderY(0.68, 0.28, materials.pumpBody, "discharge_nozzle", [2.25, SHAFT_Y + 0.86, 0], 64));
  group.add(cylinderY(0.16, 0.5, materials.pumpRim, "discharge_flange", [2.25, SHAFT_Y + 1.28, 0], 72));
  group.add(cylinderX(0.62, 0.24, materials.pumpDark, "bearing_to_casing_connector", [1.62, SHAFT_Y, 0], 56));

  group.add(roundedBox(0.88, 0.32, 0.92, materials.pumpDark, "pump_casing_pedestal", [2.22, 0.5, 0], 0.06));
  group.add(roundedBox(0.6, 0.36, 0.14, materials.pumpBody, "pump_front_support_web", [1.94, 0.68, -0.39], 0.035));
  group.add(roundedBox(0.6, 0.36, 0.14, materials.pumpBody, "pump_rear_support_web", [1.94, 0.68, 0.39], 0.035));

  addTopBolts(group, materials.bolt, [[1.88, 0.68, -0.36], [2.56, 0.68, -0.36], [1.88, 0.68, 0.36], [2.56, 0.68, 0.36]], "pump_foot_bolt");

  return group;
}

function createMachineTrain() {
  const materials = createMaterials();
  const group = new THREE.Group();
  group.name = "motor_pump_train";

  group.add(createMotorBase(materials));
  group.add(createDriveShaftAndCoupling(materials));
  group.add(createBearingHousing(materials));
  group.add(createPumpVolute(materials));

  group.updateMatrixWorld(true);
  return group;
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
        trs: false,
      },
    );
  });
}

const machineTrain = createMachineTrain();
const glb = await exportGlb(machineTrain);

await Promise.all(
  OUTPUT_PATHS.map(async (outputPath) => {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, glb);
    console.log(`Wrote ${outputPath}`);
  }),
);
