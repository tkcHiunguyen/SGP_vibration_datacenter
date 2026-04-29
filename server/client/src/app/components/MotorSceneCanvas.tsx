import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ViewportGizmo } from "three-viewport-gizmo";
import { calculateSceneLoadProgress } from "./motorSceneLoading";

const MOTOR_MODEL_URL = `${import.meta.env.BASE_URL}models/electric_motor.glb`;
const PANORAMA_URL = "/app/panoramas/panorama_datacenter_sharp_8k.jpg";
const MOTOR_GROUND_Y = 0.47;
const REFERENCE_RULER_LENGTH_METERS = 4;

type MotorSceneCanvasProps = {
  className?: string;
};

type SceneAsset = "environment" | "motor";
type SceneLoadProgress = Record<SceneAsset, number>;
type RuntimeViewportGizmoOptions = Omit<NonNullable<ConstructorParameters<typeof ViewportGizmo>[2]>, "type"> & {
  type?: "sphere" | "cube" | "rounded-cube";
};

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

function createMotorBase() {
  const base = new THREE.Group();
  base.name = "motor_base";

  const deckMaterial = new THREE.MeshStandardMaterial({
    color: 0x172131,
    roughness: 0.58,
    metalness: 0.42,
  });
  const topPlateMaterial = new THREE.MeshStandardMaterial({
    color: 0x223044,
    roughness: 0.48,
    metalness: 0.5,
  });
  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d5960,
    roughness: 0.38,
    metalness: 0.56,
  });
  const rubberMaterial = new THREE.MeshStandardMaterial({
    color: 0x05090f,
    roughness: 0.9,
    metalness: 0.04,
  });
  const boltMaterial = new THREE.MeshStandardMaterial({
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

function createReferenceRuler() {
  const ruler = new THREE.Group();
  ruler.name = "metric_reference_ruler";
  ruler.position.set(0, 0.07, -2.28);

  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
  const accentMaterial = new THREE.MeshBasicMaterial({ color: 0x5eead4 });
  const minorMaterial = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });

  const rail = new THREE.Mesh(new THREE.BoxGeometry(REFERENCE_RULER_LENGTH_METERS, 0.025, 0.025), lineMaterial);
  rail.position.x = REFERENCE_RULER_LENGTH_METERS / 2;
  rail.renderOrder = 12;
  ruler.add(rail);

  for (let meter = 0; meter <= REFERENCE_RULER_LENGTH_METERS; meter += 1) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.22, 0.035), accentMaterial);
    tick.position.x = meter;
    tick.renderOrder = 13;
    ruler.add(tick);
  }

  for (let halfMeter = 0.5; halfMeter < REFERENCE_RULER_LENGTH_METERS; halfMeter += 1) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.14, 0.024), minorMaterial);
    tick.position.x = halfMeter;
    tick.renderOrder = 13;
    ruler.add(tick);
  }

  return ruler;
}

export function MotorSceneCanvas({ className }: MotorSceneCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [loadingText, setLoadingText] = useState("Đang tải cảnh 3D");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let active = true;
    let panoramaTexture: THREE.Texture | null = null;
    const loadedAssets = new Set<SceneAsset>();
    const assetProgress: SceneLoadProgress = { environment: 0, motor: 0 };
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
    const cameraTarget = new THREE.Vector3(0, 1, 0);
    const cameraDirection = new THREE.Vector3(6.5, 3.75, 6.8).normalize();
    camera.position.copy(cameraTarget).addScaledVector(cameraDirection, 10.4);
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
      if (loadedAssets.size === 2) {
        revealSceneWhenReady();
        return;
      }

      updateLoadingText(
        loadedAssets.has("environment")
          ? "Đang tải mô hình motor"
          : "Đang tải môi trường 3D",
      );
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
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshStandardMaterial({
        color: 0x111827,
        roughness: 0.88,
        metalness: 0.08,
        side: THREE.DoubleSide,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    world.add(floor);

    const grid = new THREE.GridHelper(18, 18, 0x5eead4, 0x334155);
    grid.position.y = 0.012;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.42;
    world.add(grid);

    world.add(createMotorBase());
    world.add(createReferenceRuler());

    const axes = new THREE.Group();
    axes.position.set(0, 0.045, 0);
    world.add(axes);

    const axisLength = 2.65;
    const axisHeadLength = 0.34;
    const axisHeadWidth = 0.15;
    [
      new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), axisLength, 0xef4444, axisHeadLength, axisHeadWidth),
      new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), axisLength, 0x22c55e, axisHeadLength, axisHeadWidth),
      new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), axisLength, 0x3b82f6, axisHeadLength, axisHeadWidth),
    ].forEach((arrow) => {
      arrow.renderOrder = 10;
      axes.add(arrow);
    });

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.minDistance = 3.2;
    controls.maxDistance = 16;
    controls.target.copy(cameraTarget);
    controls.update();

    const gizmoOptions: RuntimeViewportGizmoOptions = {
      container: mount,
      type: "rounded-cube",
      size: 76,
      placement: "bottom-right",
      offset: { right: 12, bottom: 12 },
      animated: true,
      speed: 1.15,
      background: {
        color: 0x0f172a,
        opacity: 0.9,
        hover: { color: 0x1e293b, opacity: 1 },
      },
      corners: {
        color: 0x1f2937,
        opacity: 1,
      },
      edges: {
        color: 0x334155,
        opacity: 1,
      },
      x: { color: 0xef4444, label: "X", labelColor: 0xf8fafc },
      y: { color: 0x22c55e, label: "Y", labelColor: 0xf8fafc },
      z: { color: 0x3b82f6, label: "Z", labelColor: 0xf8fafc },
      nx: { color: 0x7f1d1d, label: "-X", labelColor: 0xf8fafc },
      ny: { color: 0x14532d, label: "-Y", labelColor: 0xf8fafc },
      nz: { color: 0x1e3a8a, label: "-Z", labelColor: 0xf8fafc },
    };
    const gizmo = new ViewportGizmo(
      camera,
      renderer,
      gizmoOptions as ConstructorParameters<typeof ViewportGizmo>[2],
    );
    gizmo.attachControls(controls);

    const loader = new GLTFLoader();
    updateLoadingText("Đang tải mô hình motor");
    loader.load(
      MOTOR_MODEL_URL,
      (gltf) => {
        if (!active) {
          disposeObject(gltf.scene);
          return;
        }

        const motor = gltf.scene;
        motor.traverse((child) => {
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

        fitObjectToScene(motor, 3.8);
        world.add(motor);
        markAssetLoaded("motor");
      },
      (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          updateAssetProgress("motor", progress);
          updateLoadingText(`Đang tải mô hình motor ${progress}%`);
        }
      },
      (error) => {
        console.error("Unable to load motor model", error);
        if (active) {
          setLoadingError("Không tải được mô hình motor");
        }
      },
    );

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const resolvedHeight = Math.max(1, mount.clientHeight);
      const aspect = width / resolvedHeight;
      const cameraDistance = aspect < 0.75 ? 14.2 : 10.4;
      camera.position.copy(cameraTarget).addScaledVector(cameraDirection, cameraDistance);
      camera.lookAt(cameraTarget);
      controls.target.copy(cameraTarget);
      camera.aspect = width / resolvedHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(width, resolvedHeight);
      controls.update();
      gizmo.update();
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
      gizmo.render();
    });

    return () => {
      active = false;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      gizmo.detachControls();
      gizmo.dispose();
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
      <div className="motor-scene-scale-reference" aria-label="Thước tham chiếu kích thước thực tế">
        <span>0 m</span>
        <span>Thước tham chiếu 4 m</span>
      </div>
    </div>
  );
}
