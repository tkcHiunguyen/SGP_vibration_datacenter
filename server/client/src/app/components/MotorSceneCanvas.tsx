import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MOCK_MOTOR_TWINS, type MotorTwin } from "../data/motorTwins";
import { calculateSceneLoadProgress } from "./motorSceneLoading";

const MOTOR_MODEL_URL = `${import.meta.env.BASE_URL}models/electric_motor.glb`;
const MACHINE_TRAIN_MODEL_URL = `${import.meta.env.BASE_URL}models/motor_pump_train.glb`;
const PANORAMA_URL = "/app/panoramas/panorama_datacenter_sharp_8k.jpg";
const MOTOR_GROUND_Y = 0;
const MOTOR_MODEL_TARGET_SIZE = 3.25;
const MOTOR_COUPLING_X_OFFSET = -2.38;
const MOTOR_SHAFT_TO_COUPLING_Y_OFFSET = 0.467;

type MotorSceneCanvasProps = {
  className?: string;
};

type SceneAsset = "environment" | "motorModel" | "machineTrainModel";
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

function createMotorTwinInstance(
  sourceMotor: THREE.Object3D,
  sourceMachineTrain: THREE.Object3D,
  twin: MotorTwin,
) {
  const instance = new THREE.Group();
  const metadata = {
    motorId: twin.motorId,
    sensorId: twin.sensorId,
    name: twin.name,
  };

  instance.name = `motor_twin_${twin.motorId}`;
  instance.userData = { ...instance.userData, ...metadata };
  instance.position.set(twin.position.x, twin.position.y, twin.position.z);
  instance.rotation.set(
    twin.rotation?.x ?? 0,
    twin.rotation?.y ?? 0,
    twin.rotation?.z ?? 0,
  );

  const model = sourceMotor.clone(true);
  model.name = `${instance.name}_model`;
  const machineTrain = sourceMachineTrain.clone(true);
  machineTrain.name = `${instance.name}_machine_train`;
  instance.add(machineTrain);
  instance.add(model);

  instance.traverse((child) => {
    child.userData = { ...child.userData, ...metadata };
  });

  return instance;
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
    const assetProgress: SceneLoadProgress = { environment: 0, motorModel: 0, machineTrainModel: 0 };
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
    camera.position.copy(cameraTarget).addScaledVector(cameraDirection, 12.8);
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
      if (loadedAssets.size === 3) {
        revealSceneWhenReady();
        return;
      }

      if (!loadedAssets.has("environment")) {
        updateLoadingText("Đang tải môi trường 3D");
      } else if (!loadedAssets.has("motorModel")) {
        updateLoadingText("Đang tải mô hình motor");
      } else {
        updateLoadingText("Đang tải model phụ trợ");
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
        color: 0x111827,
        roughness: 0.88,
        metalness: 0.08,
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

    const loader = new GLTFLoader();
    let motorTemplate: THREE.Object3D | null = null;
    let machineTrainTemplate: THREE.Object3D | null = null;
    let motorTwinGroupAdded = false;

    const addMotorTwinGroupIfReady = () => {
      if (!motorTemplate || !machineTrainTemplate || motorTwinGroupAdded) {
        return;
      }

      const readyMotorTemplate = motorTemplate;
      const readyMachineTrainTemplate = machineTrainTemplate;
      const motorTwinGroup = new THREE.Group();
      motorTwinGroup.name = "motor_twins_from_recorded_positions";
      MOCK_MOTOR_TWINS.forEach((motorTwin) => {
        motorTwinGroup.add(createMotorTwinInstance(readyMotorTemplate, readyMachineTrainTemplate, motorTwin));
      });
      world.add(motorTwinGroup);
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

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const resolvedHeight = Math.max(1, mount.clientHeight);
      const aspect = width / resolvedHeight;
      const cameraDistance = aspect < 0.75 ? 17.2 : 12.8;
      camera.position.copy(cameraTarget).addScaledVector(cameraDirection, cameraDistance);
      camera.lookAt(cameraTarget);
      controls.target.copy(cameraTarget);
      camera.aspect = width / resolvedHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(width, resolvedHeight);
      controls.update();
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      active = false;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
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
