import { createRequire } from "module";
import { readFileSync } from "fs";
import vm from "vm";
import * as THREE from "three";
import { unzipSync, strFromU8 } from "fflate";
import { buildDecalGeometry } from "../src/geometry.js";
import { build3mf, buildStlZip } from "../src/export.js";

const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

globalThis.ClipperLib = require("../vendor/clipper.js");
vm.runInThisContext(readFileSync(new URL("../vendor/forge.js", import.meta.url), "utf8"));
const opentype = require("../vendor/opentype.min.js");
const fontPath = "C:/Windows/Fonts/arial.ttf";
const fontBytes = readFileSync(fontPath);
const font = opentype.parse(fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength));

const hello = buildDecalGeometry({
  kind: "text",
  font: font,
  text: "HELLO",
  sizeMm: 16,
  rimMm: 1.2,
  cornerMm: 0.6,
  raiseMm: 0.8
});
hello.lettersGeo.computeBoundingBox();
const helloBox = hello.lettersGeo.boundingBox;
assert(helloBox.max.x - helloBox.min.x > 30, "HELLO is too narrow");
assert(hello.outlineGeo, "HELLO should have an outline");
assert(Math.abs(helloBox.min.z + 0.15) < 0.02, "letters should sink 0.15 mm");
assert(Math.abs(helloBox.max.z - 0.8) < 0.02, "letters should rise 0.8 mm");

const flush = buildDecalGeometry({
  kind: "text",
  font: font,
  text: "HELLO",
  sizeMm: 16,
  rimMm: 1.2,
  cornerMm: 0.6,
  raiseMm: 0.8,
  flush: true
});
flush.lettersGeo.computeBoundingBox();
assert(Math.abs(flush.lettersGeo.boundingBox.max.z) < 0.02, "flush letters should end at the surface");
assert(Math.abs(flush.lettersGeo.boundingBox.min.z + 0.8) < 0.02, "flush letters should sink by the depth");

const ring = buildDecalGeometry({
  kind: "text",
  font: font,
  text: "O",
  sizeMm: 20,
  rimMm: 1.2,
  cornerMm: 0.4,
  raiseMm: 0.8
});
ring.lettersGeo.computeBoundingBox();
const center = ring.lettersGeo.boundingBox.getCenter(new THREE.Vector3());
const mesh = new THREE.Mesh(ring.lettersGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
const throughHole = new THREE.Raycaster(
  new THREE.Vector3(center.x, center.y, 5),
  new THREE.Vector3(0, 0, -1)
).intersectObject(mesh);
assert(throughHole.length === 0, "the center of O should be open");
let strokeHits = 0;
for (let step = 1; step <= 8; step++) {
  const x = THREE.MathUtils.lerp(ring.lettersGeo.boundingBox.min.x, center.x, step / 12);
  const hits = new THREE.Raycaster(
    new THREE.Vector3(x, center.y, 5),
    new THREE.Vector3(0, 0, -1)
  ).intersectObject(mesh);
  if (hits.length) strokeHits++;
}
assert(strokeHits > 0, "the stroke of O should be solid");
const outlineMesh = new THREE.Mesh(ring.outlineGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
const throughOutlineCenter = new THREE.Raycaster(
  new THREE.Vector3(center.x, center.y, 5),
  new THREE.Vector3(0, 0, -1)
).intersectObject(outlineMesh);
assert(throughOutlineCenter.length === 0, "the outline should leave the center of O open");

const block = new THREE.BoxGeometry(60, 40, 20);
block.translate(30, 20, 10);
const parts = [
  { name: "block", geometry: block, matrix: new THREE.Matrix4() },
  { name: "Text 1 letters", geometry: hello.lettersGeo, matrix: new THREE.Matrix4() },
  { name: "Text 1 outline", geometry: hello.outlineGeo, matrix: new THREE.Matrix4() }
];
const packed = unzipSync(build3mf(parts));
assert(packed["[Content_Types].xml"], "3MF is missing content types");
assert(packed["3D/3dmodel.model"], "3MF is missing the model");
const xml = strFromU8(packed["3D/3dmodel.model"]);
assert(xml.includes('unit="millimeter"'), "3MF should use millimetres");
assert(xml.includes('name="block"'), "3MF should name the model");
assert(xml.includes('name="Text 1 letters"'), "3MF should name the letters");
assert(xml.includes('name="Text 1 outline"'), "3MF should name the outline");
assert(xml.includes("<components>"), "3MF should keep the parts together");
assert((xml.match(/<object /g) || []).length === 4, "3MF should have three parts plus the assembly");

const zip = unzipSync(buildStlZip(parts));
const names = Object.keys(zip).sort();
assert(names.length === 3, "STL zip should have three files, got " + names.join(", "));
names.forEach(function (name) {
  const bytes = zip[name];
  assert(bytes.length >= 84, name + " is too small");
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
  assert(bytes.length === 84 + count * 50, name + " triangle count does not match the file size");
  assert(count > 0, name + " has no triangles");
});

console.log("Geometry and export checks passed.");
