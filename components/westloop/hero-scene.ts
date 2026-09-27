import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export type HeroScene = {
  update: (progress: number, pointerX: number, pointerY: number) => void;
  resize: () => void;
  dispose: () => void;
};

// Object-space grime stays attached to panels as the vehicle turns.
const grimeShader = `
uniform float uClean;
varying vec3 vDetailPosition;
float hashDetail(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
float noiseDetail(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hashDetail(i),hashDetail(i+vec3(1,0,0)),f.x),
    mix(hashDetail(i+vec3(0,1,0)),hashDetail(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hashDetail(i+vec3(0,0,1)),hashDetail(i+vec3(1,0,1)),f.x),
    mix(hashDetail(i+vec3(0,1,1)),hashDetail(i+vec3(1,1,1)),f.x),f.y),f.z);
}
`;

export async function createHeroScene(host: HTMLElement, signal: AbortSignal): Promise<HeroScene> {
  const mobile = host.clientWidth < 760;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.25 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, 0.035);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.65;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xd7e7ee, 0x202119, 0.45));
  const key = new THREE.DirectionalLight(0xfff2dd, 1.5);
  key.position.set(3, 6, -2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb7d4d5, 1);
  rim.position.set(-4, 3, 4);
  scene.add(rim);

  const turntable = new THREE.Group();
  scene.add(turntable);
  const decoder = new DRACOLoader().setDecoderPath("/hero/draco/").setWorkerLimit(1);
  const loader = new GLTFLoader().setDRACOLoader(decoder);
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const clean = { value: 0 };
  const finishes: { material: THREE.MeshStandardMaterial; roughness: number; metalness: number }[] = [];
  let disposed = false;
  let car: THREE.Group | undefined;

  function collect(object: THREE.Object3D) {
    object.traverse((node) => {
      if (!(node instanceof THREE.Mesh || node instanceof THREE.Points)) return;
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    collect(scene);
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => { t.dispose(); if (typeof ImageBitmap !== "undefined" && t.image instanceof ImageBitmap) t.image.close(); });
    environment.dispose();
    decoder.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    scene.clear();
  }

  try {
    const response = await fetch("/hero/detail-car.glb", { signal });
    if (!response.ok) throw new Error("Vehicle asset unavailable");
    const gltf = await loader.parseAsync(await response.arrayBuffer(), "/hero/");
    car = gltf.scene;
    collect(car);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const body = new THREE.MeshPhysicalMaterial({ color: 0x15382e, metalness: 0.75, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x91aba8, metalness: 0.08, roughness: 0.08, transparent: true, opacity: 0.42, depthWrite: false, clearcoat: 1 });
    const wheel = new THREE.MeshStandardMaterial({ color: 0xbbc1bf, metalness: 0.95, roughness: 0.22 });
    materials.add(body); materials.add(glass); materials.add(wheel);
    car.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (material instanceof THREE.MeshStandardMaterial) {
          // FBX conversion left several cabin materials overly reflective.
          if (/leather|interior|carpet|carbon|plastic|grills|wipers|tire/.test(node.name)) {
            material.color.set(/leather/.test(node.name) ? 0x392920 : 0x161b1a);
            material.metalness = 0;
            material.roughness = 0.75;
          }
        }
      }
      if (node.name === "body") node.material = body;
      else if (node.name === "glass") node.material = glass;
      else if (node.name.startsWith("rim_") || node.name === "trim") node.material = wheel;
      // Interior surfaces retain the model's original materials.
      if (!/^(body|glass|rim_|trim|tire|wheel|lights|chrome)/.test(node.name)) return;
      const multiple = Array.isArray(node.material);
      const finished = (multiple ? node.material as THREE.Material[] : [node.material as THREE.Material]).map((original) => {
        if (!(original instanceof THREE.MeshStandardMaterial)) return original;
        const material = original.clone();
        materials.add(material);
        finishes.push({ material, roughness: material.roughness, metalness: material.metalness });
        material.onBeforeCompile = (shader) => {
          shader.uniforms.uClean = clean;
          shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vDetailPosition;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvDetailPosition = position;");
          shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\n" + grimeShader)
            .replace("#include <color_fragment>", `#include <color_fragment>
              float coarse = noiseDetail(vDetailPosition*15.0);
              float fine = noiseDetail(vDetailPosition*180.0);
              float lower = 1.0-smoothstep(0.2,1.3,vDetailPosition.y);
              float dust = clamp(0.38 + coarse*0.28 + fine*0.16 + lower*0.3,0.0,1.0);
              float wash = smoothstep(-2.6+uClean*5.8-0.4,-2.6+uClean*5.8+0.4,vDetailPosition.z);
              float dirt = dust * mix(1.0,wash,smoothstep(0.0,0.12,uClean)) * (1.0-smoothstep(0.88,1.0,uClean));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15,0.115,0.068)*(0.85+coarse*0.3), dirt*0.88);
            `);
        };
        material.customProgramCacheKey = () => "wl-grime-v1";
        return material;
      });
      node.material = multiple ? finished : finished[0];
    });
    const box = new THREE.Box3().setFromObject(car);
    const center = box.getCenter(new THREE.Vector3());
    car.position.set(-center.x, -box.min.y, -center.z);
    turntable.add(car);

    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    gradient.addColorStop(0, "rgba(0,0,0,0.8)"); gradient.addColorStop(0.6, "rgba(0,0,0,0.5)"); gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 6), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.015;
    turntable.add(shadow);

    const positions = new Float32Array(mobile ? 120 : 240);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = Math.sin(i * 13.31) * 1.7;
      positions[i + 1] = 0.15 + (0.5 + Math.sin(i * 7.17) * 0.5) * 1.5;
      positions[i + 2] = Math.cos(i * 4.71) * 0.25;
    }
    const mistGeometry = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mistMaterial = new THREE.PointsMaterial({ color: 0xd4f3e8, size: 0.026, transparent: true, opacity: 0, depthWrite: false });
    const mist = new THREE.Points(mistGeometry, mistMaterial);
    turntable.add(mist);
    collect(scene);

    let distance = 8;
    function resize() {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h || disposed) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // A bounding sphere fits every orientation, including a side profile on phones.
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      const angle = Math.min(THREE.MathUtils.degToRad(camera.fov / 2), Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
      distance = radius / Math.sin(angle) * (w < 760 ? 0.86 : 0.57);
      camera.updateProjectionMatrix();
    }
    resize();
    function update(progress: number, pointerX: number, pointerY: number) {
      if (disposed) return;
      const t = THREE.MathUtils.clamp(progress, 0, 1);
      clean.value = THREE.MathUtils.smoothstep(t, 0.12, 0.88);
      turntable.rotation.y = t * Math.PI * 2;
      camera.position.set(distance * 0.67 + pointerX * 0.14, distance * 0.24 + pointerY * 0.1, -distance * 0.7);
      camera.lookAt(0, 0.58, 0);
      for (const finish of finishes) {
        finish.material.roughness = THREE.MathUtils.lerp(0.86, finish.roughness, clean.value);
        finish.material.metalness = THREE.MathUtils.lerp(0.15, finish.metalness, clean.value);
        if (finish.material instanceof THREE.MeshPhysicalMaterial) finish.material.clearcoat = clean.value;
      }
      scene.environmentIntensity = 0.55 + clean.value * 0.35;
      key.intensity = 1.3 + clean.value * 0.5;
      rim.position.x = -4 + pointerX;
      mist.position.z = -2.6 + clean.value * 5.8;
      mistMaterial.opacity = Math.sin(clean.value * Math.PI) * 0.2;
      renderer.render(scene, camera);
    }
    update(0, 0, 0);
    return { update, resize, dispose };
  } catch (error) {
    if (car) collect(car);
    dispose();
    throw error;
  }
}
