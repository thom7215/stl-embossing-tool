import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { MOUSE } from "three";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree
} from "three-mesh-bvh/accelerated";
import { buildDecalGeometry } from "./geometry.js";
import { contoursFromSvg } from "./svg.js";
import { build3mf, buildStlZip } from "./export.js";

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const stlInput = document.getElementById("stl");
const upAxisEl = document.getElementById("up-axis");
const modelMeta = document.getElementById("model-meta");
const frameButton = document.getElementById("frame");
const selectionEl = document.getElementById("selection");
const textEl = document.getElementById("text");
const fontEl = document.getElementById("font");
const fontFilterEl = document.getElementById("font-filter");
const sizeEl = document.getElementById("size");
const rimEl = document.getElementById("rim");
const cornerEl = document.getElementById("corner");
const raiseEl = document.getElementById("raise");
const raiseLabel = document.getElementById("raise-label");
const flushEl = document.getElementById("flush");
const toolMoveButton = document.getElementById("tool-move");
const toolCenterButton = document.getElementById("tool-center");
const toolFaceButton = document.getElementById("tool-face");
const toolScaleButton = document.getElementById("tool-scale");
const toolRotateButton = document.getElementById("tool-rotate");
const toolSurfaceButton = document.getElementById("tool-surface");
const undoButton = document.getElementById("undo");
const redoButton = document.getElementById("redo");
const scalePercentEl = document.getElementById("scale-percent");
const rotateXEl = document.getElementById("rotate-x");
const rotateYEl = document.getElementById("rotate-y");
const rotateZEl = document.getElementById("rotate-z");
const toolHintEl = document.getElementById("tool-hint");
const addTextButton = document.getElementById("add-text");
const svgInput = document.getElementById("svg");
const svgPlaneEl = document.getElementById("svg-plane");
const removeButton = document.getElementById("remove");
const errorEl = document.getElementById("error");
const export3mfButton = document.getElementById("export-3mf");
const exportStlButton = document.getElementById("export-stl");
const objectList = document.getElementById("object-list");
const viewport = document.getElementById("viewport");
const canvas = document.getElementById("view");
const emptyEl = document.getElementById("empty");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x17191e);
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 20000);
camera.up.set(0, 0, 1);
camera.position.set(90, -140, 80);
const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const hemi = new THREE.HemisphereLight(0xf7f8fb, 0x2a2e36, 1.15);
hemi.position.set(0, 0, 1);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 1.45);
key.position.set(50, -90, 120);
scene.add(key);
const fill = new THREE.DirectionalLight(0xd5dbe8, 0.55);
fill.position.set(-80, 30, 40);
scene.add(fill);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = false;
controls.zoomToCursor = true;
controls.screenSpacePanning = true;
controls.rotateSpeed = 0.85;
controls.panSpeed = 0.85;
controls.zoomSpeed = 0.9;
controls.mouseButtons.LEFT = -1;
controls.mouseButtons.MIDDLE = MOUSE.PAN;
controls.mouseButtons.RIGHT = MOUSE.ROTATE;
controls.update();

const VIEW_CUBE = 112;
const VIEW_CUBE_MARGIN = 14;
const viewFaces = [
  { dir: new THREE.Vector3(1, 0, 0), label: "Right", color: "#3c465c" },
  { dir: new THREE.Vector3(-1, 0, 0), label: "Left", color: "#3c465c" },
  { dir: new THREE.Vector3(0, 1, 0), label: "Back", color: "#343c50" },
  { dir: new THREE.Vector3(0, -1, 0), label: "Front", color: "#4c5870" },
  { dir: new THREE.Vector3(0, 0, 1), label: "Top", color: "#5c6b88" },
  { dir: new THREE.Vector3(0, 0, -1), label: "Bottom", color: "#2c3240" }
];
const cubeScene = new THREE.Scene();
const cubeCamera = new THREE.OrthographicCamera(-1.45, 1.45, 1.45, -1.45, 0.1, 10);
cubeCamera.position.set(0, 0, 5);
const cubeRoot = new THREE.Group();
cubeScene.add(cubeRoot);
const cubeDisc = new THREE.Mesh(
  new THREE.CircleGeometry(1.38, 48),
  new THREE.MeshBasicMaterial({ color: 0x101218, transparent: true, opacity: 0.82 })
);
cubeDisc.position.z = -0.4;
cubeScene.add(cubeDisc);
const cubeFaces = viewFaces.map(function (face) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.12, 1.12),
    new THREE.MeshBasicMaterial({ map: faceTexture(face.label, face.color), color: 0xc5cad6 })
  );
  mesh.position.copy(face.dir).multiplyScalar(0.64);
  orientFace(mesh, face.dir);
  mesh.userData.viewDirection = face.dir;
  cubeRoot.add(mesh);
  return mesh;
});
const cubeHit = new THREE.Mesh(
  new THREE.BoxGeometry(1.28, 1.28, 1.28),
  new THREE.MeshBasicMaterial({ visible: false })
);
cubeRoot.add(cubeHit);
const cubeRaycaster = new THREE.Raycaster();
const cubePointer = new THREE.Vector2();
const savedViewport = new THREE.Vector4();
let cubeHover = null;
let viewAnim = null;

function faceTexture(label, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const pen = canvas.getContext("2d");
  pen.fillStyle = color;
  pen.fillRect(0, 0, 256, 256);
  pen.strokeStyle = "rgba(255,255,255,0.28)";
  pen.lineWidth = 10;
  pen.strokeRect(8, 8, 240, 240);
  pen.fillStyle = "#f4f7fb";
  pen.font = "700 52px Segoe UI, sans-serif";
  pen.textAlign = "center";
  pen.textBaseline = "middle";
  pen.fillText(label, 128, 132);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function orientFace(mesh, normal) {
  const z = normal.clone().normalize();
  const up = Math.abs(z.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const basis = new THREE.Matrix4().makeBasis(x, y, z);
  mesh.quaternion.setFromRotationMatrix(basis);
}

function cubeArea() {
  return {
    x: viewport.clientWidth - VIEW_CUBE - VIEW_CUBE_MARGIN,
    y: VIEW_CUBE_MARGIN,
    size: VIEW_CUBE
  };
}

function syncCube() {
  cubeRoot.quaternion.copy(camera.quaternion).invert();
  cubeRoot.updateMatrixWorld(true);
}

function overViewCube(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const area = cubeArea();
  return x >= area.x && y >= area.y && x <= area.x + area.size && y <= area.y + area.size;
}

function cubeHitAt(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const area = cubeArea();
  if (!overViewCube(event)) return null;
  cubePointer.set(((x - area.x) / area.size) * 2 - 1, -((y - area.y) / area.size) * 2 + 1);
  syncCube();
  cubeRaycaster.setFromCamera(cubePointer, cubeCamera);
  return cubeRaycaster.intersectObject(cubeHit, false)[0] || null;
}

function faceForNormal(normal) {
  let best = cubeFaces[0];
  let score = -2;
  cubeFaces.forEach(function (face) {
    const dot = face.userData.viewDirection.dot(normal);
    if (dot > score) {
      score = dot;
      best = face;
    }
  });
  return best;
}

function setCubeHover(face) {
  if (face === cubeHover) return;
  cubeHover = face;
  cubeFaces.forEach(function (item) {
    item.material.color.set(item === face ? 0xffffff : 0xc5cad6);
  });
}

function lookAlong(direction) {
  const dist = Math.max(camera.position.distanceTo(controls.target), 30);
  const dir = direction.clone().normalize();
  if (Math.abs(dir.z) > 0.98) dir.y -= Math.sign(dir.z) * 0.02;
  dir.normalize();
  viewAnim = {
    from: camera.position.clone(),
    to: controls.target.clone().addScaledVector(dir, dist),
    t: 0
  };
}

function stepViewAnim() {
  if (!viewAnim) return;
  viewAnim.t = Math.min(1, viewAnim.t + 0.08);
  const k = viewAnim.t * viewAnim.t * (3 - 2 * viewAnim.t);
  camera.position.lerpVectors(viewAnim.from, viewAnim.to, k);
  if (viewAnim.t >= 1) viewAnim = null;
}

function renderViewCube() {
  syncCube();
  const area = cubeArea();
  const height = viewport.clientHeight;
  renderer.getViewport(savedViewport);
  renderer.setViewport(area.x, height - area.y - area.size, area.size, area.size);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(cubeScene, cubeCamera);
  renderer.autoClear = true;
  renderer.setViewport(savedViewport.x, savedViewport.y, savedViewport.z, savedViewport.w);
}

const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
const pointer = new THREE.Vector2();
const _normal = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _plane = new THREE.Plane();
const _center = new THREE.Vector3();
const _xAxis = new THREE.Vector3(1, 0, 0);
const _zUp = new THREE.Vector3(0, 0, 1);
const _down = new THREE.Vector3(0, 0, -1);
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _euler = new THREE.Euler();
const _compose = new THREE.Quaternion();
const _gizmoCenter = new THREE.Vector3();
const ROTATE_AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1)
};
const rotateGizmo = new THREE.Group();
rotateGizmo.visible = false;
scene.add(rotateGizmo);
const rotatePickers = [];
const rotateVisuals = {};
const rotateRings = {};

function snapTickGeometry() {
  const positions = [];
  for (let step = 0; step < 36; step++) {
    const angle = step * Math.PI / 18;
    const major = step % 9 === 0;
    const inner = major ? 0.68 : 0.8;
    const outer = 0.94;
    positions.push(Math.cos(angle) * inner, Math.sin(angle) * inner, 0);
    positions.push(Math.cos(angle) * outer, Math.sin(angle) * outer, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function addRotateRing(name, color, rx, ry) {
  const holder = new THREE.Group();
  holder.rotation.set(rx, ry, 0);
  const material = new THREE.MeshBasicMaterial({
    color: color,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.011, 8, 96), material);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  mesh.userData.axis = name;
  mesh.userData.baseColor = color;
  mesh.raycast = function () {};
  const ticks = new THREE.LineSegments(snapTickGeometry(), new THREE.LineBasicMaterial({
    color: color,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.9
  }));
  ticks.renderOrder = 11;
  ticks.frustumCulled = false;
  ticks.visible = false;
  ticks.raycast = function () {};
  const pick = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.07, 6, 48),
    new THREE.MeshBasicMaterial({ visible: false, depthWrite: false, side: THREE.DoubleSide })
  );
  pick.renderOrder = 10;
  pick.frustumCulled = false;
  pick.userData.axis = name;
  holder.add(mesh);
  holder.add(ticks);
  holder.add(pick);
  rotateGizmo.add(holder);
  rotatePickers.push(pick);
  rotateVisuals[name] = mesh;
  rotateRings[name] = { holder: holder, ticks: ticks };
}

addRotateRing("x", 0xe06a62, 0, Math.PI / 2);
addRotateRing("y", 0x3cba54, Math.PI / 2, 0);
addRotateRing("z", 0x3b82f0, 0, 0);

let ringHover = null;
function showActiveAxis(name) {
  Object.keys(rotateRings).forEach(function (key) {
    const ring = rotateRings[key];
    ring.holder.visible = !name || key === name;
    ring.ticks.visible = key === name;
  });
}

function setRingHover(name) {
  if (ringHover === name) return;
  ringHover = name;
  Object.keys(rotateVisuals).forEach(function (key) {
    const mesh = rotateVisuals[key];
    mesh.material.color.setHex(key === name ? 0xffffff : mesh.userData.baseColor);
    mesh.material.opacity = key === name ? 1 : 0.92;
  });
}

const selectionBox = new THREE.BoxHelper(new THREE.Group(), 0xf4f7fb);
selectionBox.visible = false;
selectionBox.raycast = function () {};
scene.add(selectionBox);

let grid = null;
let model = null;
let modelUserScale = 1;
const modelTurn = new THREE.Quaternion();
let modelFileName = "model";
let appliedUp = "z";
let decals = [];
let selected = null;
let currentFont = null;
let suppress = false;
let rebuildTimer = 0;
let drag = null;
let tool = "place";
let nextDecalId = 1;
let historyLock = false;
const undoStack = [];
const redoStack = [];
const fontCache = new Map();
const loader = new STLLoader();

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function readNum(input, fallback, min, max) {
  let n = Number(input.value);
  if (!Number.isFinite(n)) n = fallback;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

function selectedDecal() {
  return selected && selected.type === "decal" ? selected.decal : null;
}

function letterMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x1c1e24,
    roughness: 0.42,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
}

function outlineMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xd24b24,
    roughness: 0.4,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
}

function modelMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xb7bcc6,
    roughness: 0.62,
    metalness: 0.04,
    flatShading: true,
    side: THREE.DoubleSide
  });
}

function quaternionFromNormal(normal, degrees) {
  const z = normal.clone().normalize();
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1);
  const worldUp = new THREE.Vector3(0, 0, 1);
  const y = worldUp.clone().addScaledVector(z, -worldUp.dot(z));
  if (y.lengthSq() < 1e-8) y.set(0, 1, 0);
  y.normalize();
  if (degrees) y.applyAxisAngle(z, THREE.MathUtils.degToRad(degrees));
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function applyOrientation(decal) {
  decal.group.quaternion.copy(quaternionFromNormal(decal.facing, decal.twist));
}

function outwardNormal(hit) {
  const normal = hit.face && hit.face.normal
    ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
    : new THREE.Vector3(0, 0, 1);
  normal.normalize();
  const view = hit.point.clone().sub(camera.position);
  if (normal.dot(view) > 0) normal.negate();
  return normal;
}

function setPointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickTargets() {
  const targets = [];
  decals.forEach(function (decal) {
    targets.push(decal.letters);
    if (decal.outline) targets.push(decal.outline);
  });
  if (model) targets.push(model);
  return targets;
}

function firstHit() {
  const hits = raycaster.intersectObjects(pickTargets(), false);
  return hits[0] || null;
}

function updateGrid() {
  if (grid) {
    scene.remove(grid);
    grid.geometry.dispose();
    grid.material.dispose();
  }
  let size = 200;
  let z = 0;
  const box = new THREE.Box3();
  if (model) box.expandByObject(model);
  decals.forEach(function (decal) { box.expandByObject(decal.group); });
  if (!box.isEmpty()) {
    const dims = box.getSize(new THREE.Vector3());
    size = Math.max(dims.x, dims.y, 40) * 1.8;
    z = box.min.z;
  }
  grid = new THREE.GridHelper(size, 20, 0x3c4250, 0x2a2e38);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = z;
  grid.raycast = function () {};
  scene.add(grid);
}

function updateMeta() {
  if (!model) {
    modelMeta.textContent = "No model yet. You can also drop an STL on the view.";
    return;
  }
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const count = model.geometry.index
    ? model.geometry.index.count / 3
    : model.geometry.getAttribute("position").count / 3;
  modelMeta.textContent =
    modelFileName + " · " +
    size.x.toFixed(1) + " × " + size.y.toFixed(1) + " × " + size.z.toFixed(1) +
    " mm · " + Math.round(count).toLocaleString() + " triangles";
}

function refreshExport() {
  const ready = !!model || decals.length > 0;
  export3mfButton.disabled = !ready;
  exportStlButton.disabled = !ready;
}

function refreshHighlight() {
  if (model) model.material.emissive.setHex(selected && selected.type === "model" ? 0x2c3a52 : 0x000000);
  decals.forEach(function (decal) {
    const on = selectedDecal() === decal;
    decal.letters.material.emissive.setHex(on ? 0x2a4466 : 0x000000);
    if (decal.outline) decal.outline.material.emissive.setHex(on ? 0x4a2414 : 0x000000);
  });
  if (selected && selected.type === "decal") {
    selectionBox.setFromObject(selected.decal.group);
    selectionBox.visible = true;
  } else if (selected && selected.type === "model" && model) {
    selectionBox.setFromObject(model);
    selectionBox.visible = true;
  } else {
    selectionBox.visible = false;
  }
}

function describeSelection() {
  const decal = selectedDecal();
  if (decal) {
    const name = decal.kind === "svg" ? (decal.label || "SVG") : "Text “" + (decal.text || "").trim() + "”";
    const size = decal.span.width.toFixed(1) + " × " + decal.span.height.toFixed(1) + " mm";
    return name + " · " + size;
  }
  if (selected && selected.type === "model") return modelFileName + " selected";
  return "Nothing selected";
}

function wrapDeg(value) {
  let degrees = value;
  while (degrees > 180) degrees -= 360;
  while (degrees < -180) degrees += 360;
  if (Math.abs(degrees) < 0.05) return 0;
  return Math.round(degrees * 10) / 10;
}

function degreesFromQuaternion(quaternion) {
  _euler.setFromQuaternion(quaternion, "XYZ");
  return {
    x: wrapDeg(THREE.MathUtils.radToDeg(_euler.x)),
    y: wrapDeg(THREE.MathUtils.radToDeg(_euler.y)),
    z: wrapDeg(THREE.MathUtils.radToDeg(_euler.z))
  };
}

function writeDegrees(quaternion) {
  const degrees = quaternion ? degreesFromQuaternion(quaternion) : { x: 0, y: 0, z: 0 };
  rotateXEl.value = String(degrees.x);
  rotateYEl.value = String(degrees.y);
  rotateZEl.value = String(degrees.z);
}

function selectedScale() {
  const decal = selectedDecal();
  if (decal) {
    const base = decal.baseSizeMm || decal.sizeMm || 1;
    return decal.sizeMm / base;
  }
  if (selected && selected.type === "model") return modelUserScale;
  return 1;
}

function currentTurnQuaternion() {
  const decal = selectedDecal();
  if (decal) return decal.group.quaternion.clone();
  if (selected && selected.type === "model") return modelTurn.clone();
  return null;
}

function syncTransformFields() {
  const on = !!selected;
  scalePercentEl.disabled = !on;
  rotateXEl.disabled = !on;
  rotateYEl.disabled = !on;
  rotateZEl.disabled = !on;
  if (!on) {
    scalePercentEl.value = "100";
    writeDegrees(null);
    return;
  }
  scalePercentEl.value = String(Math.round(selectedScale() * 100));
  writeDegrees(currentTurnQuaternion());
}

function updateRaiseLabel() {
  raiseLabel.textContent = flushEl.checked ? "Depth into the surface (mm)" : "Thickness (mm)";
}

function syncForm() {
  suppress = true;
  const decal = selectedDecal();
  removeButton.disabled = !decal;
  toolCenterButton.disabled = !selected;
  selectionEl.textContent = describeSelection();
  if (decal) {
    sizeEl.value = String(decal.sizeMm);
    rimEl.value = String(decal.rimMm);
    cornerEl.value = String(decal.cornerMm);
    raiseEl.value = String(decal.raiseMm);
    flushEl.checked = !!decal.flush;
    if (decal.kind === "text") {
      textEl.value = decal.text;
      currentFont = decal.font;
      if (decal.fontId && fontEl.querySelector('option[value="' + decal.fontId + '"]')) {
        fontEl.value = decal.fontId;
      }
    }
  }
  syncTransformFields();
  suppress = false;
  updateRaiseLabel();
  refreshHighlight();
  refreshExport();
  renderObjectList();
  emptyEl.hidden = !!model || decals.length > 0;
}

function objectName(decal) {
  if (decal.kind === "svg") return decal.label || "SVG";
  return (decal.text || "").trim() || "Text";
}

function objectButton(label, title, current, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  if (current) button.setAttribute("aria-current", "true");
  const kind = document.createElement("span");
  kind.className = "kind";
  kind.textContent = label;
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = title;
  button.append(kind, name);
  button.addEventListener("click", onClick);
  return button;
}

function renderObjectList() {
  objectList.replaceChildren();
  if (!model && !decals.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Load a model, or add text or an SVG.";
    objectList.appendChild(empty);
    return;
  }
  if (model) {
    objectList.appendChild(objectButton("Model", modelFileName, selected && selected.type === "model", selectModel));
  }
  decals.forEach(function (decal, index) {
    const kind = (decal.kind === "svg" ? "SVG " : "Text ") + (index + 1);
    objectList.appendChild(objectButton(
      kind,
      objectName(decal),
      selectedDecal() === decal,
      function () { selectDecal(decal); }
    ));
  });
}

function selectDecal(decal) {
  selected = { type: "decal", decal: decal };
  syncForm();
}

function selectModel() {
  selected = model ? { type: "model" } : null;
  syncForm();
}

function selectNone() {
  selected = null;
  syncForm();
}

function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.geometry.dispose();
  mesh.material.dispose();
}

function clearDecals() {
  decals.forEach(function (decal) {
    scene.remove(decal.group);
    disposeMesh(decal.letters);
    disposeMesh(decal.outline);
  });
  decals = [];
  if (selected && selected.type === "decal") selected = null;
}

function swapGeometry(decal, built) {
  decal.letters.geometry.dispose();
  decal.letters.geometry = built.lettersGeo;
  if (built.outlineGeo) {
    if (decal.outline) {
      decal.outline.geometry.dispose();
      decal.outline.geometry = built.outlineGeo;
    } else {
      decal.outline = new THREE.Mesh(built.outlineGeo, outlineMaterial());
      decal.outline.userData.decal = decal;
      decal.outline.renderOrder = 2;
      decal.group.add(decal.outline);
    }
  } else if (decal.outline) {
    decal.group.remove(decal.outline);
    disposeMesh(decal.outline);
    decal.outline = null;
  }
  decal.span.width = built.width;
  decal.span.height = built.height;
}

function rebuildDecal(decal) {
  try {
    const built = buildDecalGeometry(decal);
    swapGeometry(decal, built);
    showError("");
    if (selectedDecal() === decal) selectionEl.textContent = describeSelection();
    renderObjectList();
    refreshHighlight();
  } catch (err) {
    showError(err.message || "Could not update that shape.");
  }
}

function scheduleRebuild(decal) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(function () {
    rebuildDecal(decal);
  }, 80);
}

function specFromForm() {
  return {
    sizeMm: readNum(sizeEl, 16, 0.5, 1000),
    rimMm: readNum(rimEl, 1.2, 0, 80),
    cornerMm: readNum(cornerEl, 0.6, 0, 80),
    raiseMm: readNum(raiseEl, 0.4, 0.2, 80),
    twist: 0,
    flush: flushEl.checked,
    font: currentFont,
    fontId: fontEl.value,
    text: textEl.value
  };
}

function createDecal(spec) {
  const built = buildDecalGeometry(spec);
  if (spec.id && spec.id >= nextDecalId) nextDecalId = spec.id + 1;
  const decal = {
    id: spec.id || nextDecalId++,
    kind: spec.kind,
    text: spec.text || "",
    font: spec.font || null,
    fontId: spec.fontId || "",
    sourceContours: spec.sourceContours || null,
    label: spec.label || "",
    sizeMm: spec.sizeMm,
    baseSizeMm: spec.baseSizeMm || spec.sizeMm,
    rimMm: spec.rimMm,
    cornerMm: spec.cornerMm,
    raiseMm: spec.raiseMm,
    flush: !!spec.flush,
    twist: spec.twist || 0,
    attached: false,
    facing: new THREE.Vector3(0, 0, 1),
    group: new THREE.Group(),
    letters: new THREE.Mesh(built.lettersGeo, letterMaterial()),
    outline: null,
    span: { width: built.width, height: built.height }
  };
  decal.letters.userData.decal = decal;
  decal.letters.renderOrder = 2;
  decal.group.add(decal.letters);
  if (built.outlineGeo) {
    decal.outline = new THREE.Mesh(built.outlineGeo, outlineMaterial());
    decal.outline.userData.decal = decal;
    decal.outline.renderOrder = 2;
    decal.group.add(decal.outline);
  }
  decal.group.userData.decal = decal;
  scene.add(decal.group);
  decals.push(decal);
  return decal;
}

function centerHit() {
  if (!model) return null;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObject(model, false);
  return hits[0] || null;
}

function restick(decal) {
  if (!model) {
    decal.attached = false;
    return false;
  }
  _normal.copy(decal.facing).normalize();
  raycaster.ray.origin.copy(decal.group.position).addScaledVector(_normal, 80);
  raycaster.ray.direction.copy(_normal).negate();
  let hits = raycaster.intersectObject(model, false);
  if (!hits.length) {
    const screen = decal.group.position.clone().project(camera);
    if (screen.z < 1) {
      raycaster.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);
      hits = raycaster.intersectObject(model, false);
    }
  }
  if (!hits.length) {
    decal.attached = false;
    return false;
  }
  decal.facing.copy(outwardNormal(hits[0]));
  decal.group.position.copy(hits[0].point);
  decal.attached = true;
  applyOrientation(decal);
  return true;
}

function bedLift(decal) {
  const mesh = decal.letters || decal.outline;
  if (!mesh) return 0;
  mesh.geometry.computeBoundingBox();
  return -mesh.geometry.boundingBox.min.z;
}

function placeOnBed(decal) {
  decal.facing.set(0, 0, 1);
  decal.twist = 0;
  decal.attached = false;
  applyOrientation(decal);
  const lift = bedLift(decal);
  const previous = selectedDecal();
  const previousOnBed = previous && !previous.attached && previous.facing.z > 0.9;
  if (previousOnBed) {
    const shift = (previous.span.width + decal.span.width) / 2 + 2;
    decal.group.position.set(previous.group.position.x + shift, previous.group.position.y, lift);
    return;
  }
  if (model) {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    decal.group.position.set(center.x, box.min.y - decal.span.height / 2 - 6, lift);
    return;
  }
  decal.group.position.set(0, 0, lift);
}

function placeNew(decal) {
  const previous = selectedDecal();
  if (previous) {
    decal.twist = previous.twist;
    decal.facing.copy(previous.facing);
    decal.attached = !!(previous.attached && model);
    applyOrientation(decal);
    const shift = (previous.span.width + decal.span.width) / 2 + 2;
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(previous.group.quaternion);
    decal.group.position.copy(previous.group.position).addScaledVector(x, shift);
    if (decal.attached) restick(decal);
    return;
  }
  const hit = centerHit();
  decal.twist = 0;
  if (hit) {
    decal.facing.copy(outwardNormal(hit));
    decal.group.position.copy(hit.point);
    decal.attached = true;
  } else {
    camera.getWorldDirection(decal.facing).negate();
    decal.group.position.copy(controls.target);
    decal.attached = false;
  }
  applyOrientation(decal);
}

function frameModel() {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(model);
  decals.forEach(function (decal) {
    box.expandByObject(decal.group);
  });
  if (box.isEmpty()) return;
  const center = box.getCenter(_center);
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5 || 10;
  const dist = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.35;
  camera.near = Math.max(0.02, radius / 800);
  camera.far = Math.max(2000, radius * 80);
  camera.updateProjectionMatrix();
  camera.position.set(center.x + dist * 0.35, center.y - dist, center.z + dist * 0.42);
  controls.target.copy(center);
  controls.minDistance = Math.max(0.4, radius * 0.02);
  controls.maxDistance = dist * 14;
  controls.update();
  updateGrid();
}

function baseName(name) {
  return String(name || "model").replace(/\.[^.]+$/, "") || "model";
}

function refreshModelBounds() {
  const geometry = model.geometry;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (geometry.boundsTree && geometry.disposeBoundsTree) geometry.disposeBoundsTree();
  try {
    geometry.computeBoundsTree();
  } catch (err) {
    console.warn(err);
  }
  updateMeta();
  updateGrid();
  refreshHighlight();
}

function bakeModelPose() {
  if (!model) return;
  model.updateMatrix();
  const moved = model.position.lengthSq() > 1e-12;
  const scaled = Math.abs(model.scale.x - 1) > 1e-6 || Math.abs(model.scale.y - 1) > 1e-6 || Math.abs(model.scale.z - 1) > 1e-6;
  const turned = Math.abs(model.quaternion.x) + Math.abs(model.quaternion.y) + Math.abs(model.quaternion.z) > 1e-6;
  if (!moved && !scaled && !turned) return;
  model.geometry.applyMatrix4(model.matrix);
  model.position.set(0, 0, 0);
  model.quaternion.identity();
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);
  refreshModelBounds();
}

function geometryReferenced(geometry) {
  if (model && model.geometry === geometry) return true;
  return undoStack.some(function (snap) { return snap.modelGeometry === geometry; })
    || redoStack.some(function (snap) { return snap.modelGeometry === geometry; });
}

function dropSnapshot(snap) {
  const geometry = snap.modelGeometry;
  if (!geometry || geometryReferenced(geometry)) return;
  if (geometry.disposeBoundsTree) geometry.disposeBoundsTree();
  geometry.dispose();
}

function severModelGeometry() {
  if (!model) return;
  const current = model.geometry;
  function detach(stack) {
    stack.forEach(function (snap) {
      if (snap.modelGeometry === current) snap.modelGeometry = current.clone();
    });
  }
  detach(undoStack);
  detach(redoStack);
}

function cloneContours(contours) {
  if (!contours) return null;
  return contours.map(function (ring) {
    return ring.map(function (point) { return { x: point.x, y: point.y }; });
  });
}

function snapshot() {
  return {
    modelFileName: modelFileName,
    appliedUp: appliedUp,
    modelGeometry: model ? model.geometry : null,
    modelPosition: model ? model.position.clone() : null,
    modelQuaternion: model ? model.quaternion.clone() : null,
    modelScale: model ? model.scale.clone() : null,
    modelUserScale: modelUserScale,
    modelTurn: modelTurn.clone(),
    decals: decals.map(function (decal) {
      return {
        id: decal.id,
        kind: decal.kind,
        text: decal.text,
        font: decal.font,
        fontId: decal.fontId,
        sourceContours: cloneContours(decal.sourceContours),
        label: decal.label,
        sizeMm: decal.sizeMm,
        baseSizeMm: decal.baseSizeMm || decal.sizeMm,
        rimMm: decal.rimMm,
        cornerMm: decal.cornerMm,
        raiseMm: decal.raiseMm,
        flush: !!decal.flush,
        twist: decal.twist,
        attached: !!decal.attached,
        facing: decal.facing.clone(),
        position: decal.group.position.clone(),
        quaternion: decal.group.quaternion.clone()
      };
    }),
    selected: !selected ? null : selected.type === "model"
      ? { type: "model" }
      : { type: "decal", id: selected.decal.id }
  };
}

function updateHistoryButtons() {
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
}

function pushHistory() {
  if (historyLock) return;
  undoStack.push(snapshot());
  if (undoStack.length > 30) dropSnapshot(undoStack.shift());
  const discarded = redoStack.splice(0, redoStack.length);
  discarded.forEach(dropSnapshot);
  updateHistoryButtons();
}

function shapeKey(decal) {
  return [
    decal.kind,
    decal.text,
    decal.sizeMm,
    decal.rimMm,
    decal.cornerMm,
    decal.raiseMm,
    decal.flush ? 1 : 0,
    decal.fontId,
    decal.label
  ].join("|");
}

function copyDecalState(decal, spec) {
  const before = shapeKey(decal);
  decal.text = spec.text;
  decal.font = spec.font;
  decal.fontId = spec.fontId;
  decal.sourceContours = spec.sourceContours;
  decal.label = spec.label;
  decal.sizeMm = spec.sizeMm;
  if (spec.baseSizeMm) decal.baseSizeMm = spec.baseSizeMm;
  else if (!decal.baseSizeMm) decal.baseSizeMm = spec.sizeMm;
  decal.rimMm = spec.rimMm;
  decal.cornerMm = spec.cornerMm;
  decal.raiseMm = spec.raiseMm;
  decal.flush = !!spec.flush;
  decal.twist = spec.twist;
  decal.attached = !!spec.attached;
  decal.facing.copy(spec.facing);
  if (shapeKey(decal) !== before) rebuildDecal(decal);
  decal.group.position.copy(spec.position);
  decal.group.quaternion.copy(spec.quaternion);
  decal.group.updateMatrixWorld(true);
}

function applySnapshot(snap) {
  historyLock = true;
  clearTimeout(rebuildTimer);
  appliedUp = snap.appliedUp;
  upAxisEl.value = appliedUp === "y" ? "y" : "z";
  modelFileName = snap.modelFileName;
  modelUserScale = Number.isFinite(snap.modelUserScale) ? snap.modelUserScale : 1;
  if (snap.modelTurn) modelTurn.copy(snap.modelTurn);
  else modelTurn.identity();
  if (snap.modelGeometry) {
    const nextGeometry = snap.modelGeometry.clone();
    if (!model) {
      model = new THREE.Mesh(nextGeometry, modelMaterial());
      scene.add(model);
    } else {
      const old = model.geometry;
      model.geometry = nextGeometry;
      if (old !== snap.modelGeometry && !geometryReferenced(old)) {
        if (old.disposeBoundsTree) old.disposeBoundsTree();
        old.dispose();
      }
    }
    model.position.copy(snap.modelPosition);
    model.quaternion.copy(snap.modelQuaternion);
    model.scale.copy(snap.modelScale);
    model.updateMatrixWorld(true);
    refreshModelBounds();
  } else if (model) {
    const old = model.geometry;
    scene.remove(model);
    model.material.dispose();
    model = null;
    if (!geometryReferenced(old)) {
      if (old.disposeBoundsTree) old.disposeBoundsTree();
      old.dispose();
    }
  }
  const byId = new Map();
  decals.forEach(function (decal) { byId.set(decal.id, decal); });
  const nextDecals = [];
  snap.decals.forEach(function (spec) {
    let decal = byId.get(spec.id);
    if (!decal) decal = createDecal(spec);
    else byId.delete(spec.id);
    if (decal) byId.delete(spec.id);
    copyDecalState(decal, spec);
    nextDecals.push(decal);
  });
  byId.forEach(function (decal) {
    scene.remove(decal.group);
    disposeMesh(decal.letters);
    disposeMesh(decal.outline);
  });
  decals = nextDecals;
  if (snap.selected && snap.selected.type === "model" && model) selected = { type: "model" };
  else if (snap.selected && snap.selected.type === "decal") {
    const decal = decals.find(function (item) { return item.id === snap.selected.id; });
    selected = decal ? { type: "decal", decal: decal } : null;
  } else selected = null;
  historyLock = false;
  updateGrid();
  updateMeta();
  syncForm();
}

function undo() {
  if (!undoStack.length || historyLock) return;
  clearTimeout(rebuildTimer);
  const previous = undoStack.pop();
  redoStack.push(snapshot());
  applySnapshot(previous);
  updateHistoryButtons();
}

function redo() {
  if (!redoStack.length || historyLock) return;
  clearTimeout(rebuildTimer);
  const next = redoStack.pop();
  undoStack.push(snapshot());
  applySnapshot(next);
  updateHistoryButtons();
}

function rotateModelAndDecals(angle) {
  severModelGeometry();
  bakeModelPose();
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const geometry = model.geometry;
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.rotateX(angle);
  geometry.translate(center.x, center.y, center.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (geometry.boundsTree && geometry.disposeBoundsTree) geometry.disposeBoundsTree();
  try {
    geometry.computeBoundsTree();
  } catch (err) {
    console.warn(err);
  }
  const q = new THREE.Quaternion().setFromAxisAngle(_xAxis, angle);
  modelTurn.premultiply(q);
  decals.forEach(function (decal) {
    decal.group.position.sub(center).applyQuaternion(q).add(center);
    decal.facing.applyQuaternion(q).normalize();
    applyOrientation(decal);
  });
}

function prepareGeometry(geometry) {
  if (appliedUp === "y") {
    geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(center.x, center.y, center.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  try {
    geometry.computeBoundsTree();
  } catch (err) {
    console.warn(err);
  }
  return geometry;
}

function loadStlBuffer(buffer, name) {
  if (!historyLock) {
    pushHistory();
    severModelGeometry();
  }
  const geometry = loader.parse(buffer);
  const position = geometry.getAttribute("position");
  if (!position || position.count < 3) throw new Error("That STL has no triangles.");
  prepareGeometry(geometry);
  if (model) {
    scene.remove(model);
    if (model.geometry.disposeBoundsTree) model.geometry.disposeBoundsTree();
    model.geometry.dispose();
    model.material.dispose();
  }
  clearDecals();
  model = new THREE.Mesh(geometry, modelMaterial());
  scene.add(model);
  modelFileName = name || "model.stl";
  modelUserScale = 1;
  modelTurn.identity();
  frameModel();
  selectModel();
  updateMeta();
  showError("");
}

async function loadStlFile(file) {
  modelMeta.textContent = "Reading " + file.name + "…";
  showError("");
  await new Promise(function (resolve) { setTimeout(resolve, 30); });
  try {
    const buffer = await file.arrayBuffer();
    modelMeta.textContent = "Preparing the surface…";
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    loadStlBuffer(buffer, file.name);
  } catch (err) {
    updateMeta();
    showError(err.message || "Could not read that STL.");
  }
}

function readInto(decal) {
  decal.sizeMm = readNum(sizeEl, decal.sizeMm, 0.5, 1000);
  decal.rimMm = readNum(rimEl, decal.rimMm, 0, 80);
  decal.cornerMm = readNum(cornerEl, decal.cornerMm, 0, 80);
  decal.raiseMm = readNum(raiseEl, decal.raiseMm, 0.2, 80);
  decal.flush = flushEl.checked;
  if (decal.kind === "text") {
    decal.text = textEl.value;
    decal.font = currentFont;
    decal.fontId = fontEl.value;
  }
}

function onShapeInput() {
  if (suppress || historyLock) return;
  const decal = selectedDecal();
  if (!decal) return;
  pushHistory();
  readInto(decal);
  syncTransformFields();
  scheduleRebuild(decal);
}

async function ensureFont(id) {
  if (fontCache.has(id)) {
    currentFont = fontCache.get(id);
    return currentFont;
  }
  const url = id === "bundled" ? "vendor/anton-latin.woff" : "/api/font/" + id;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not read that font.");
  const font = opentype.parse(await response.arrayBuffer());
  fontCache.set(id, font);
  currentFont = font;
  return font;
}

async function addText() {
  try {
    const font = currentFont || await ensureFont(fontEl.value);
    if (!font) throw new Error("Choose a font first.");
    const spec = specFromForm();
    spec.kind = "text";
    spec.font = font;
    pushHistory();
    const decal = createDecal(spec);
    placeNew(decal);
    selectDecal(decal);
    showError("");
  } catch (err) {
    showError(err.message || "Could not add that text.");
  }
}

async function loadSvgFile(file) {
  try {
    const contours = contoursFromSvg(await file.text());
    const spec = specFromForm();
    spec.kind = "svg";
    spec.rimMm = 0;
    spec.sourceContours = contours;
    spec.label = file.name;
    pushHistory();
    const decal = createDecal(spec);
    if (svgPlaneEl.value === "bed") placeOnBed(decal);
    else placeNew(decal);
    selectDecal(decal);
    showError("");
  } catch (err) {
    showError(err.message || "Could not add that SVG.");
  }
}

function removeSelected() {
  const decal = selectedDecal();
  if (!decal) return;
  pushHistory();
  scene.remove(decal.group);
  disposeMesh(decal.letters);
  disposeMesh(decal.outline);
  decals = decals.filter(function (item) { return item !== decal; });
  selectNone();
}

function collectParts() {
  scene.updateMatrixWorld(true);
  const parts = [];
  const stem = baseName(modelFileName);
  if (model) {
    parts.push({ name: stem, geometry: model.geometry, matrix: model.matrixWorld });
  }
  decals.forEach(function (decal, index) {
    const label = decal.kind === "svg" ? "SVG" : "Text";
    const art = decal.kind === "svg" ? "art" : "letters";
    parts.push({
      name: label + " " + (index + 1) + " " + art,
      geometry: decal.letters.geometry,
      matrix: decal.letters.matrixWorld
    });
    if (decal.outline) {
      parts.push({
        name: label + " " + (index + 1) + " outline",
        geometry: decal.outline.geometry,
        matrix: decal.outline.matrixWorld
      });
    }
  });
  return parts;
}

function download(bytes, name, type) {
  const blob = new Blob([bytes], { type: type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
}

async function runExport(kind) {
  const button = kind === "3mf" ? export3mfButton : exportStlButton;
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = "Exporting…";
  await new Promise(function (resolve) { setTimeout(resolve, 30); });
  try {
    const parts = collectParts();
    const stem = baseName(modelFileName);
    if (kind === "3mf") download(build3mf(parts), stem + ".3mf", "application/octet-stream");
    else download(buildStlZip(parts), stem + "-parts.zip", "application/zip");
    showError("");
  } catch (err) {
    showError(err.message || "Could not export.");
  } finally {
    button.textContent = previous;
    refreshExport();
  }
}

const TOOL_HINTS = {
  place: "Left-drag slides text or an SVG on the face.",
  move: "Drag moves the selected object across the bed. Height stays put.",
  face: "Click a face of the selected object. That face lies flat on the bed.",
  surface: "Click a face of another object. The selected object sits on that face.",
  scale: "Drag left or right to resize the selected object. The percent is its size compared with the original.",
  rotate: "Drag inside a ring to snap every 10°. Drag outside a ring for a free turn. Red is X, green is Y, blue is Z."
};

function setTool(next) {
  tool = tool === next ? "place" : next;
  toolMoveButton.setAttribute("aria-pressed", tool === "move" ? "true" : "false");
  toolFaceButton.setAttribute("aria-pressed", tool === "face" ? "true" : "false");
  toolSurfaceButton.setAttribute("aria-pressed", tool === "surface" ? "true" : "false");
  toolScaleButton.setAttribute("aria-pressed", tool === "scale" ? "true" : "false");
  toolRotateButton.setAttribute("aria-pressed", tool === "rotate" ? "true" : "false");
  toolHintEl.textContent = TOOL_HINTS[tool];
  canvas.style.cursor = "";
  if (tool !== "rotate") {
    setRingHover(null);
    showActiveAxis(null);
  }
  syncRotateGizmo();
}

function clampNum(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function attachedDecalStarts() {
  return decals.filter(function (item) { return item.attached; }).map(function (item) {
    return { decal: item, position: item.group.position.clone() };
  });
}

function translateSelectionXY(dx, dy) {
  if (!dx && !dy) return;
  const decal = selectedDecal();
  if (decal) {
    decal.group.position.x += dx;
    decal.group.position.y += dy;
    return;
  }
  if (selected && selected.type === "model" && model) {
    model.position.x += dx;
    model.position.y += dy;
    decals.forEach(function (item) {
      if (!item.attached) return;
      item.group.position.x += dx;
      item.group.position.y += dy;
    });
  }
}

function centerOnBed() {
  const target = selectedDecal()
    ? selectedDecal().group
    : (selected && selected.type === "model" ? model : null);
  if (!target) return;
  pushHistory();
  const center = new THREE.Box3().setFromObject(target).getCenter(new THREE.Vector3());
  translateSelectionXY(-center.x, -center.y);
  updateGrid();
  updateMeta();
  refreshHighlight();
}

function layFaceOnBed(hit) {
  if (!model) return;
  pushHistory();
  severModelGeometry();
  const normal = outwardNormal(hit);
  const pivot = hit.point.clone();
  bakeModelPose();
  const turn = new THREE.Quaternion().setFromUnitVectors(normal, _down);
  const geometry = model.geometry;
  geometry.translate(-pivot.x, -pivot.y, -pivot.z);
  geometry.applyQuaternion(turn);
  geometry.translate(pivot.x, pivot.y, pivot.z);
  geometry.translate(0, 0, -pivot.z);
  modelTurn.premultiply(turn);
  refreshModelBounds();
  decals.forEach(function (decal) {
    decal.group.position.sub(pivot).applyQuaternion(turn).add(pivot);
    decal.group.position.z -= pivot.z;
    decal.facing.applyQuaternion(turn).normalize();
    applyOrientation(decal);
  });
  selectModel();
  showError("");
}

function twistFromQuaternion(facing, quaternion) {
  const base = quaternionFromNormal(facing, 0);
  const delta = base.invert().multiply(quaternion);
  let degrees = THREE.MathUtils.radToDeg(2 * Math.atan2(delta.z, delta.w));
  while (degrees > 180) degrees -= 360;
  while (degrees < -180) degrees += 360;
  return degrees;
}

function layDecalOnBed(decal, hit) {
  pushHistory();
  const normal = outwardNormal(hit);
  const pivot = hit.point.clone();
  const turn = new THREE.Quaternion().setFromUnitVectors(normal, _down);
  decal.group.position.sub(pivot).applyQuaternion(turn).add(pivot);
  decal.group.position.z -= pivot.z;
  decal.group.quaternion.premultiply(turn);
  decal.facing.set(0, 0, 1).applyQuaternion(decal.group.quaternion).normalize();
  decal.twist = twistFromQuaternion(decal.facing, decal.group.quaternion.clone());
  decal.attached = false;
  applyOrientation(decal);
  decal.group.updateMatrixWorld(true);
  updateGrid();
  selectDecal(decal);
  showError("");
}

function roundMm(value) {
  return Math.round(value * 100) / 100;
}

function scaleDecalParams(decal, factor) {
  decal.sizeMm = roundMm(clampNum(decal.sizeMm * factor, 0.5, 1000));
  decal.rimMm = roundMm(clampNum(decal.rimMm * factor, 0, 80));
  decal.cornerMm = roundMm(clampNum(decal.cornerMm * factor, 0, 80));
  decal.raiseMm = roundMm(clampNum(decal.raiseMm * factor, 0.2, 80));
}

function resetScalePreview(state) {
  if (state.decal) {
    state.decal.group.scale.set(1, 1, 1);
    return;
  }
  if (!model) return;
  model.scale.set(1, 1, 1);
  model.position.set(0, 0, 0);
  state.decalStarts.forEach(function (item) {
    item.decal.group.scale.set(1, 1, 1);
    item.decal.group.position.copy(item.position);
  });
}

function finishScale(state) {
  const factor = state.factor;
  if (Math.abs(factor - 1) < 0.001) {
    resetScalePreview(state);
    syncTransformFields();
    return;
  }
  if (state.decal) {
    state.decal.group.scale.set(1, 1, 1);
    scaleDecalParams(state.decal, factor);
    rebuildDecal(state.decal);
    syncForm();
    return;
  }
  if (!model) return;
  const center = state.localCenter;
  model.geometry.translate(-center.x, -center.y, -center.z);
  model.geometry.scale(factor, factor, factor);
  model.geometry.translate(center.x, center.y, center.z);
  model.position.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);
  modelUserScale *= factor;
  refreshModelBounds();
  state.decalStarts.forEach(function (item) {
    item.decal.group.scale.set(1, 1, 1);
    scaleDecalParams(item.decal, factor);
    rebuildDecal(item.decal);
  });
  syncForm();
}

function applyScale(factor) {
  if (!Number.isFinite(factor) || factor <= 0) return;
  const decal = selectedDecal();
  if (!decal && !(selected && selected.type === "model" && model)) {
    showError("Select an object in the list, then scale it.");
    return;
  }
  pushHistory();
  if (decal) {
    scaleDecalParams(decal, factor);
    rebuildDecal(decal);
    syncForm();
    return;
  }
  severModelGeometry();
  bakeModelPose();
  const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  const starts = attachedDecalStarts();
  starts.forEach(function (item) {
    item.decal.group.position.copy(center).add(item.position.clone().sub(center).multiplyScalar(factor));
  });
  finishScale({
    decal: null,
    factor: factor,
    localCenter: center,
    decalStarts: starts
  });
}

function previewScale(state, factor) {
  state.factor = factor;
  scalePercentEl.value = String(Math.round((state.baseScale || 1) * factor * 100));
  if (state.decal) {
    state.decal.group.scale.setScalar(factor);
    return;
  }
  model.scale.setScalar(factor);
  model.position.copy(state.localCenter).multiplyScalar(1 - factor);
  state.decalStarts.forEach(function (item) {
    item.decal.group.position.copy(state.center).add(item.position.clone().sub(state.center).multiplyScalar(factor));
    item.decal.group.scale.setScalar(factor);
  });
}

function turnIsSmall(quaternion) {
  return 2 * Math.acos(Math.min(1, Math.abs(quaternion.w))) < 1e-4;
}

function previewRotate(state) {
  const turn = state.turn;
  if (state.decal) {
    state.decal.group.quaternion.copy(state.startQuat).premultiply(turn);
    writeDegrees(state.decal.group.quaternion);
    return;
  }
  model.quaternion.copy(turn);
  _from.copy(state.center).applyQuaternion(turn);
  model.position.copy(state.center).sub(_from);
  state.decalStarts.forEach(function (item) {
    item.decal.group.quaternion.copy(item.quaternion).premultiply(turn);
    item.decal.group.position.copy(state.center).add(_to.copy(item.position).sub(state.center).applyQuaternion(turn));
  });
  writeDegrees(_compose.copy(turn).multiply(modelTurn));
}

function resetRotatePreview(state) {
  if (state.decal) {
    if (state.startQuat) state.decal.group.quaternion.copy(state.startQuat);
    return;
  }
  if (!model) return;
  model.position.set(0, 0, 0);
  model.quaternion.identity();
  (state.decalStarts || []).forEach(function (item) {
    item.decal.group.position.copy(item.position);
    item.decal.group.quaternion.copy(item.quaternion);
  });
}

function finishRotate(state) {
  const turn = state.turn;
  if (!turn || turnIsSmall(turn)) {
    resetRotatePreview(state);
    syncTransformFields();
    return;
  }
  if (state.decal) {
    commitDecalTurn(state.decal);
    updateGrid();
    syncForm();
    return;
  }
  if (!model) return;
  const center = state.center;
  model.geometry.translate(-center.x, -center.y, -center.z);
  model.geometry.applyQuaternion(turn);
  model.geometry.translate(center.x, center.y, center.z);
  model.position.set(0, 0, 0);
  model.quaternion.identity();
  model.updateMatrixWorld(true);
  modelTurn.premultiply(turn);
  refreshModelBounds();
  state.decalStarts.forEach(function (item) {
    commitDecalTurn(item.decal);
  });
  updateGrid();
  syncForm();
}

function applyTurn(turn) {
  if (!turn || turnIsSmall(turn)) {
    syncTransformFields();
    return;
  }
  const decal = selectedDecal();
  if (!decal && !(selected && selected.type === "model" && model)) {
    showError("Select an object in the list, then rotate it.");
    syncTransformFields();
    return;
  }
  pushHistory();
  const state = { decal: decal, prepared: false, turn: turn.clone() };
  prepareRotate(state);
  previewRotate(state);
  finishRotate(state);
}

function onRotateFieldChange() {
  const current = currentTurnQuaternion();
  if (!current) {
    showError("Select an object in the list, then rotate it.");
    syncTransformFields();
    return;
  }
  const typed = {
    x: wrapDeg(readNum(rotateXEl, 0, -360, 360)),
    y: wrapDeg(readNum(rotateYEl, 0, -360, 360)),
    z: wrapDeg(readNum(rotateZEl, 0, -360, 360))
  };
  const shown = degreesFromQuaternion(current);
  if (
    Math.abs(typed.x - shown.x) < 0.05 &&
    Math.abs(typed.y - shown.y) < 0.05 &&
    Math.abs(typed.z - shown.z) < 0.05
  ) {
    writeDegrees(current);
    return;
  }
  const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(typed.x),
    THREE.MathUtils.degToRad(typed.y),
    THREE.MathUtils.degToRad(typed.z),
    "XYZ"
  ));
  applyTurn(target.multiply(current.invert()));
}

function planeDistance(axis, pivot, point) {
  _from.copy(point).sub(pivot);
  const along = _from.dot(axis);
  return Math.sqrt(Math.max(0, _from.lengthSq() - along * along));
}

function signedAngle(axis, pivot, from, to) {
  _from.copy(from).sub(pivot);
  _to.copy(to).sub(pivot);
  _from.addScaledVector(axis, -_from.dot(axis));
  _to.addScaledVector(axis, -_to.dot(axis));
  if (_from.lengthSq() < 1e-10 || _to.lengthSq() < 1e-10) return 0;
  _from.normalize();
  _to.normalize();
  _cross.crossVectors(_from, _to);
  return Math.atan2(_cross.dot(axis), _from.dot(_to));
}

function beginRotateDrag(event, axisName) {
  const target = selectionTarget();
  if (!target) {
    showError("Select an object in the list, then rotate it.");
    return;
  }
  const axis = ROTATE_AXES[axisName];
  if (!axis) return;
  const pivot = new THREE.Vector3();
  const decal = selectedDecal();
  if (decal) pivot.copy(decal.group.position);
  else new THREE.Box3().setFromObject(model).getCenter(pivot);
  _plane.setFromNormalAndCoplanarPoint(axis, pivot);
  const grab = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(_plane, grab)) return;
  drag = {
    kind: "rotate",
    decal: decal,
    axis: axis.clone(),
    axisName: axisName,
    pivot: pivot,
    grab: grab,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    prepared: false,
    turn: new THREE.Quaternion(),
    ringRadius: rotateGizmo.scale.x
  };
  setRingHover(axisName);
  showActiveAxis(axisName);
}

function ringHit() {
  if (!rotateGizmo.visible) return null;
  const previous = raycaster.firstHitOnly;
  raycaster.firstHitOnly = false;
  const hits = raycaster.intersectObjects(rotatePickers, false);
  raycaster.firstHitOnly = previous;
  return hits[0] || null;
}

function syncRotateGizmo() {
  const target = tool === "rotate" ? selectionTarget() : null;
  rotateGizmo.visible = !!target;
  if (!target) return;
  const decal = selectedDecal();
  let radius = 24;
  if (decal) radius = Math.max(decal.span.width, decal.span.height, 12) * 0.62;
  else if (model && model.geometry.boundingSphere) radius = Math.max(model.geometry.boundingSphere.radius * 1.05, 12);
  if (decal) _gizmoCenter.copy(decal.group.position);
  else new THREE.Box3().setFromObject(target).getCenter(_gizmoCenter);
  rotateGizmo.position.copy(_gizmoCenter);
  rotateGizmo.scale.setScalar(radius);
}

function commitDecalTurn(decal) {
  decal.facing.set(0, 0, 1).applyQuaternion(decal.group.quaternion).normalize();
  let degrees = twistFromQuaternion(decal.facing, decal.group.quaternion.clone());
  if (Math.abs(degrees) < 0.05) degrees = 0;
  decal.twist = Math.round(degrees * 10) / 10;
  applyOrientation(decal);
}

function attachedTurnStarts() {
  return decals.filter(function (item) { return item.attached; }).map(function (item) {
    return {
      decal: item,
      position: item.group.position.clone(),
      quaternion: item.group.quaternion.clone()
    };
  });
}

function prepareRotate(state) {
  state.prepared = true;
  if (state.decal) {
    state.startQuat = state.decal.group.quaternion.clone();
    return;
  }
  severModelGeometry();
  bakeModelPose();
  state.center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  state.decalStarts = attachedTurnStarts();
}

function grabFrom(decal, hit) {
  if (decal.attached && model) {
    const hits = raycaster.intersectObject(model, false);
    if (hits[0]) {
      const local = decal.group.worldToLocal(hits[0].point.clone());
      return { x: local.x, y: local.y, z: 0, plane: hits[0].point.clone() };
    }
  }
  const local = decal.group.worldToLocal(hit.point.clone());
  return { x: local.x, y: local.y, z: local.z, plane: hit.point.clone() };
}

function selectionTarget() {
  const decal = selectedDecal();
  if (decal) return decal.group;
  if (selected && selected.type === "model" && model) return model;
  return null;
}

function beginMoveDrag(event) {
  const target = selectionTarget();
  if (!target) {
    showError("Select an object in the list, then move it.");
    return;
  }
  const decal = selectedDecal();
  const center = new THREE.Box3().setFromObject(target).getCenter(new THREE.Vector3());
  _plane.setFromNormalAndCoplanarPoint(_zUp, center);
  const grab = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(_plane, grab)) grab.copy(center);
  drag = {
    kind: "move",
    decal: decal,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    grabPoint: grab,
    startDecal: decal ? decal.group.position.clone() : null,
    startModel: model ? model.position.clone() : null,
    decalStarts: decal ? [] : attachedDecalStarts()
  };
}

function beginScaleDrag(event) {
  const decal = selectedDecal();
  if (!decal && !(selected && selected.type === "model" && model)) {
    showError("Select an object in the list, then scale it.");
    return;
  }
  drag = {
    kind: "scale",
    decal: decal,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    prepared: false,
    factor: 1,
    baseScale: selectedScale()
  };
}

function beginDrag(event, hit, decal) {
  if (!decal) return;
  drag = {
    kind: "place",
    decal: decal,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    grab: grabFrom(decal, hit),
    grabPoint: hit.point.clone(),
    startDecal: decal.group.position.clone()
  };
}

function slideOnBed(state) {
  _plane.setFromNormalAndCoplanarPoint(_zUp, state.grabPoint);
  if (!raycaster.ray.intersectPlane(_plane, _hit)) return null;
  return {
    dx: _hit.x - state.grabPoint.x,
    dy: _hit.y - state.grabPoint.y
  };
}

function moveDrag(event) {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    drag.moved = true;
    canvas.style.cursor = drag.kind === "scale" ? "ew-resize" : "grabbing";
    if (drag.kind === "move" || drag.kind === "scale" || drag.kind === "rotate") pushHistory();
  }
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  if (drag.kind === "scale") {
    if (!drag.prepared) {
      drag.prepared = true;
      if (!drag.decal && model) {
        severModelGeometry();
        bakeModelPose();
        const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
        drag.center = center.clone();
        drag.localCenter = center.clone();
        drag.decalStarts = attachedDecalStarts();
      }
    }
    const factor = Math.min(100, Math.max(0.05, Math.exp((event.clientX - drag.x) * 0.005)));
    previewScale(drag, factor);
    return;
  }
  if (drag.kind === "rotate") {
    _plane.setFromNormalAndCoplanarPoint(drag.axis, drag.pivot);
    if (!raycaster.ray.intersectPlane(_plane, _hit)) return;
    const distance = planeDistance(drag.axis, drag.pivot, _hit);
    let angle = signedAngle(drag.axis, drag.pivot, drag.grab, _hit);
    if (drag.ringRadius > 0 && distance < drag.ringRadius) {
      const step = Math.PI / 18;
      angle = Math.round(angle / step) * step;
    }
    if (!drag.prepared) prepareRotate(drag);
    drag.turn.setFromAxisAngle(drag.axis, angle);
    previewRotate(drag);
    return;
  }
  if (drag.kind === "move") {
    const shift = slideOnBed(drag);
    if (!shift) return;
    if (drag.decal) {
      drag.decal.group.position.x = drag.startDecal.x + shift.dx;
      drag.decal.group.position.y = drag.startDecal.y + shift.dy;
      return;
    }
    if (model && drag.startModel) {
      model.position.x = drag.startModel.x + shift.dx;
      model.position.y = drag.startModel.y + shift.dy;
      drag.decalStarts.forEach(function (item) {
        item.decal.group.position.x = item.position.x + shift.dx;
        item.decal.group.position.y = item.position.y + shift.dy;
      });
    }
    return;
  }
  const decal = drag.decal;
  if (decal.attached && model) {
    const hits = raycaster.intersectObject(model, false);
    if (!hits.length) return;
    decal.facing.copy(outwardNormal(hits[0]));
    applyOrientation(decal);
    const offset = new THREE.Vector3(drag.grab.x, drag.grab.y, 0).applyQuaternion(decal.group.quaternion);
    decal.group.position.copy(hits[0].point).sub(offset);
    return;
  }
  const shift = slideOnBed(drag);
  if (!shift) return;
  decal.group.position.x = drag.startDecal.x + shift.dx;
  decal.group.position.y = drag.startDecal.y + shift.dy;
}

function selectedTargets() {
  const targets = [];
  const decal = selectedDecal();
  if (decal) {
    targets.push(decal.letters);
    if (decal.outline) targets.push(decal.outline);
  } else if (selected && selected.type === "model" && model) {
    targets.push(model);
  }
  return targets;
}

function otherTargets() {
  const targets = [];
  const current = selectedDecal();
  decals.forEach(function (decal) {
    if (decal === current) return;
    targets.push(decal.letters);
    if (decal.outline) targets.push(decal.outline);
  });
  if (model && !(selected && selected.type === "model")) targets.push(model);
  return targets;
}

function boxCorners(box) {
  const corners = [];
  [box.min.x, box.max.x].forEach(function (x) {
    [box.min.y, box.max.y].forEach(function (y) {
      [box.min.z, box.max.z].forEach(function (z) {
        corners.push(new THREE.Vector3(x, y, z));
      });
    });
  });
  return corners;
}

function placeDecalOnSurface(decal, hit) {
  decal.facing.copy(outwardNormal(hit));
  decal.group.position.copy(hit.point);
  decal.attached = hit.object === model;
  applyOrientation(decal);
  updateGrid();
  selectDecal(decal);
  showError("");
}

function placeModelOnSurface(hit) {
  const normal = outwardNormal(hit);
  const point = hit.point.clone();
  const targetDecal = hit.object.userData.decal || null;
  if (targetDecal) targetDecal.attached = false;
  severModelGeometry();
  bakeModelPose();
  const turn = new THREE.Quaternion().setFromUnitVectors(_zUp, normal);
  const pivot = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  const geometry = model.geometry;
  geometry.translate(-pivot.x, -pivot.y, -pivot.z);
  geometry.applyQuaternion(turn);
  geometry.translate(pivot.x, pivot.y, pivot.z);
  modelTurn.premultiply(turn);
  decals.forEach(function (decal) {
    if (!decal.attached) return;
    decal.group.position.sub(pivot).applyQuaternion(turn).add(pivot);
    decal.facing.applyQuaternion(turn).normalize();
    applyOrientation(decal);
  });
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  let minDot = Infinity;
  boxCorners(box).forEach(function (corner) {
    const dot = corner.dot(normal);
    if (dot < minDot) minDot = dot;
  });
  const centerPlane = center.clone().addScaledVector(normal, -normal.dot(center));
  const pointPlane = point.clone().addScaledVector(normal, -normal.dot(point));
  const delta = pointPlane.sub(centerPlane);
  delta.addScaledVector(normal, point.dot(normal) - minDot);
  geometry.translate(delta.x, delta.y, delta.z);
  decals.forEach(function (decal) {
    if (!decal.attached) return;
    decal.group.position.add(delta);
  });
  refreshModelBounds();
  selectModel();
  showError("");
}

function placeSelectionOnSurface(hit) {
  const decal = selectedDecal();
  pushHistory();
  if (decal) placeDecalOnSurface(decal, hit);
  else if (selected && selected.type === "model" && model) placeModelOnSurface(hit);
}

function hoverCursor(hit) {
  if (tool === "face" || tool === "surface") return selected ? "crosshair" : "";
  if (tool === "scale") return selected ? "ew-resize" : "";
  if (tool === "rotate") return selected ? "grab" : "";
  if (tool === "move") return selected ? "grab" : "";
  return hit && hit.object.userData.decal ? "grab" : "";
}

canvas.addEventListener("pointerdown", function (event) {
  if (event.button === 1 || event.button === 2) {
    event.preventDefault();
    viewAnim = null;
  }
  if (event.button === 2) canvas.style.cursor = "move";
  if (event.button === 1) canvas.style.cursor = "all-scroll";
  if (event.button !== 0) return;
  if (overViewCube(event)) {
    const cubePick = cubeHitAt(event);
    if (cubePick) {
      const face = faceForNormal(cubePick.face.normal);
      setCubeHover(face);
      lookAlong(face.userData.viewDirection);
    }
    return;
  }
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  if (tool === "move") {
    beginMoveDrag(event);
    return;
  }
  if (tool === "scale") {
    beginScaleDrag(event);
    return;
  }
  if (tool === "rotate") {
    const ring = ringHit();
    if (ring) beginRotateDrag(event, ring.object.userData.axis);
    else if (!selectionTarget()) showError("Select an object in the list, then rotate it.");
    return;
  }
  if (tool === "face") {
    if (!selected) {
      showError("Select an object in the list first.");
      return;
    }
    const targets = selectedTargets();
    const face = targets.length ? raycaster.intersectObjects(targets, false)[0] : null;
    if (!face) {
      showError("Click a face of the selected object.");
      return;
    }
    if (face.object.userData.decal) layDecalOnBed(face.object.userData.decal, face);
    else layFaceOnBed(face);
    return;
  }
  if (tool === "surface") {
    if (!selected) {
      showError("Select an object in the list first.");
      return;
    }
    const targets = otherTargets();
    const hit = targets.length ? raycaster.intersectObjects(targets, false)[0] : null;
    if (!hit) {
      showError("Click a face of another object.");
      return;
    }
    placeSelectionOnSurface(hit);
    return;
  }
  const hit = firstHit();
  if (!hit) {
    selectNone();
    return;
  }
  const decal = hit.object.userData.decal || null;
  if (decal) selectDecal(decal);
  else if (hit.object === model) selectModel();
  else return;
  if (decal) beginDrag(event, hit, decal);
});

window.addEventListener("pointermove", function (event) {
  if (drag) {
    moveDrag(event);
    return;
  }
  if (event.buttons) return;
  if (!event.target || event.target !== canvas) {
    setCubeHover(null);
    setRingHover(null);
    return;
  }
  const cubePick = cubeHitAt(event);
  if (cubePick) {
    setRingHover(null);
    setCubeHover(faceForNormal(cubePick.face.normal));
    canvas.style.cursor = "pointer";
    return;
  }
  setCubeHover(null);
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  if (tool === "rotate") {
    const ring = ringHit();
    setRingHover(ring ? ring.object.userData.axis : null);
    canvas.style.cursor = ring ? "grab" : "";
    return;
  }
  setRingHover(null);
  canvas.style.cursor = hoverCursor(firstHit());
});

window.addEventListener("pointerup", function (event) {
  if (event.button === 0 && drag) {
    const rotating = drag.kind === "rotate";
    if (drag.kind === "scale" && drag.moved) finishScale(drag);
    else if (drag.kind === "rotate" && drag.moved) finishRotate(drag);
    else if (drag.kind === "move" && drag.moved) {
      updateGrid();
      updateMeta();
    }
    drag = null;
    if (rotating) showActiveAxis(null);
  }
  if (event.button === 1 || event.button === 2 || event.button === 0) {
    if (!drag) canvas.style.cursor = "";
  }
});

canvas.addEventListener("contextmenu", function (event) {
  event.preventDefault();
});

viewport.addEventListener("dragover", function (event) {
  event.preventDefault();
});

viewport.addEventListener("drop", function (event) {
  event.preventDefault();
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  const name = file.name.toLowerCase();
  if (name.endsWith(".stl")) loadStlFile(file);
  else if (name.endsWith(".svg")) loadSvgFile(file);
  else showError("Drop an STL or a filled SVG.");
});

stlInput.addEventListener("change", function () {
  const file = stlInput.files && stlInput.files[0];
  stlInput.value = "";
  if (file) loadStlFile(file);
});

upAxisEl.addEventListener("change", function () {
  const next = upAxisEl.value === "y" ? "y" : "z";
  if (!model) {
    appliedUp = next;
    return;
  }
  if (next === appliedUp) return;
  pushHistory();
  rotateModelAndDecals(next === "y" ? -Math.PI / 2 : Math.PI / 2);
  appliedUp = next;
  frameModel();
  updateMeta();
  refreshHighlight();
  syncTransformFields();
});

frameButton.addEventListener("click", frameModel);
addTextButton.addEventListener("click", addText);
svgInput.addEventListener("change", function () {
  const file = svgInput.files && svgInput.files[0];
  svgInput.value = "";
  if (file) loadSvgFile(file);
});
removeButton.addEventListener("click", removeSelected);
export3mfButton.addEventListener("click", function () { runExport("3mf"); });
exportStlButton.addEventListener("click", function () { runExport("stl"); });

[sizeEl, rimEl, cornerEl, raiseEl, textEl].forEach(function (input) {
  input.addEventListener("input", onShapeInput);
});
flushEl.addEventListener("change", function () {
  updateRaiseLabel();
  onShapeInput();
});
toolMoveButton.addEventListener("click", function () { setTool("move"); });
toolFaceButton.addEventListener("click", function () { setTool("face"); });
toolSurfaceButton.addEventListener("click", function () { setTool("surface"); });
toolScaleButton.addEventListener("click", function () { setTool("scale"); });
toolRotateButton.addEventListener("click", function () { setTool("rotate"); });
undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
toolCenterButton.addEventListener("click", centerOnBed);
scalePercentEl.addEventListener("change", function () {
  const current = selectedScale();
  const percent = readNum(scalePercentEl, Math.round(current * 100), 5, 2000);
  const target = percent / 100;
  if (Math.abs(target - current) < 0.005) {
    scalePercentEl.value = String(Math.round(current * 100));
    return;
  }
  applyScale(target / current);
});
[rotateXEl, rotateYEl, rotateZEl].forEach(function (input) {
  input.addEventListener("change", onRotateFieldChange);
});

fontEl.addEventListener("change", async function () {
  try {
    await ensureFont(fontEl.value);
    showError("");
    onShapeInput();
  } catch (err) {
    showError(err.message || "Could not read that font.");
  }
});

fontFilterEl.addEventListener("input", function () {
  const query = fontFilterEl.value.trim().toLowerCase();
  Array.from(fontEl.options).forEach(function (option) {
    const matches = option.textContent.toLowerCase().includes(query);
    option.hidden = !!query && option.value !== fontEl.value && !matches;
  });
});

window.addEventListener("keydown", function (event) {
  const tag = document.activeElement && document.activeElement.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (!typing && (event.ctrlKey || event.metaKey) && (event.key === "z" || event.key === "Z")) {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (!typing && (event.ctrlKey || event.metaKey) && (event.key === "y" || event.key === "Y")) {
    event.preventDefault();
    redo();
    return;
  }
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (typing) return;
  if (!selectedDecal()) return;
  event.preventDefault();
  removeSelected();
});

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function animate() {
  requestAnimationFrame(animate);
  if (selectionBox.visible && selected) {
    if (selected.type === "decal") selectionBox.setFromObject(selected.decal.group);
    else if (model) selectionBox.setFromObject(model);
  }
  stepViewAnim();
  controls.update();
  syncRotateGizmo();
  renderer.render(scene, camera);
  renderViewCube();
}

async function loadFontList() {
  try {
    const response = await fetch("/api/fonts");
    if (!response.ok) return;
    const fonts = await response.json();
    fonts.forEach(function (font) {
      const option = document.createElement("option");
      option.value = font.id;
      option.textContent = font.name;
      fontEl.appendChild(option);
    });
  } catch (err) {
    console.warn(err);
  }
}

updateGrid();
resize();
window.addEventListener("resize", resize);
new ResizeObserver(resize).observe(viewport);
animate();
syncForm();

ensureFont("bundled").then(function () {
  addTextButton.disabled = false;
}).catch(function () {
  showError("Could not load the built-in font.");
});
loadFontList();
