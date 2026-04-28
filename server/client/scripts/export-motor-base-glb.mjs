import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

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

function createMotorBase() {
  const base = new THREE.Group();
  base.name = "motor_base";

  const deckMaterial = new THREE.MeshStandardMaterial({
    name: "deck_material",
    color: 0x172131,
    roughness: 0.58,
    metalness: 0.42,
  });
  const topPlateMaterial = new THREE.MeshStandardMaterial({
    name: "top_plate_material",
    color: 0x223044,
    roughness: 0.48,
    metalness: 0.5,
  });
  const railMaterial = new THREE.MeshStandardMaterial({
    name: "rail_material",
    color: 0x2d5960,
    roughness: 0.38,
    metalness: 0.56,
  });
  const rubberMaterial = new THREE.MeshStandardMaterial({
    name: "rubber_material",
    color: 0x05090f,
    roughness: 0.9,
    metalness: 0.04,
  });
  const boltMaterial = new THREE.MeshStandardMaterial({
    name: "bolt_material",
    color: 0xb6c0cc,
    roughness: 0.24,
    metalness: 0.86,
  });

  const deck = new THREE.Mesh(new RoundedBoxGeometry(5.25, 0.22, 2.95, 5, 0.08), deckMaterial);
  deck.name = "deck";
  deck.position.y = 0.11;
  deck.castShadow = true;
  deck.receiveShadow = true;
  base.add(deck);

  const topPlate = new THREE.Mesh(new RoundedBoxGeometry(4.65, 0.12, 2.42, 5, 0.05), topPlateMaterial);
  topPlate.name = "top_plate";
  topPlate.position.y = 0.28;
  topPlate.castShadow = true;
  topPlate.receiveShadow = true;
  base.add(topPlate);

  [-0.72, 0.72].forEach((z, index) => {
    const rail = new THREE.Mesh(new RoundedBoxGeometry(4.25, 0.16, 0.22, 4, 0.04), railMaterial);
    rail.name = `rail_${index + 1}`;
    rail.position.set(0, 0.42, z);
    rail.castShadow = true;
    rail.receiveShadow = true;
    base.add(rail);
  });

  [
    [-1.45, -0.72],
    [1.45, -0.72],
    [-1.45, 0.72],
    [1.45, 0.72],
  ].forEach(([x, z], index) => {
    const pad = new THREE.Mesh(new RoundedBoxGeometry(0.68, 0.08, 0.38, 4, 0.04), rubberMaterial);
    pad.name = `rubber_pad_${index + 1}`;
    pad.position.set(x, 0.52, z);
    pad.castShadow = true;
    pad.receiveShadow = true;
    base.add(pad);
  });

  [
    [-2.28, -1.15],
    [2.28, -1.15],
    [-2.28, 1.15],
    [2.28, 1.15],
  ].forEach(([x, z], index) => {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.055, 24), boltMaterial);
    bolt.name = `bolt_${index + 1}`;
    bolt.position.set(x, 0.43, z);
    bolt.castShadow = true;
    bolt.receiveShadow = true;
    base.add(bolt);
  });

  return base;
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
      },
    );
  });
}

const base = createMotorBase();
base.updateMatrixWorld(true);

const outputPaths = [
  resolve("public/models/motor_base.glb"),
  resolve("../server/public/app/models/motor_base.glb"),
];

const glb = await exportGlb(base);

await Promise.all(
  outputPaths.map(async (outputPath) => {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, glb);
    console.log(`Wrote ${outputPath}`);
  }),
);
