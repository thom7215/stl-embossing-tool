import * as THREE from "three";
import { strToU8, zipSync } from "fflate";

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

function fmt(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1e5) / 1e5;
  if (rounded === 0) return "0";
  return String(rounded);
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fileSlug(name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "part";
}

export function trianglesFromMesh(geometry, matrix) {
  const position = geometry.getAttribute("position");
  if (!position) return [];
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const triangles = [];
  for (let i = 0; i < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    _a.fromBufferAttribute(position, ia);
    _b.fromBufferAttribute(position, ib);
    _c.fromBufferAttribute(position, ic);
    if (matrix) {
      _a.applyMatrix4(matrix);
      _b.applyMatrix4(matrix);
      _c.applyMatrix4(matrix);
    }
    const abx = _b.x - _a.x;
    const aby = _b.y - _a.y;
    const abz = _b.z - _a.z;
    const acx = _c.x - _a.x;
    const acy = _c.y - _a.y;
    const acz = _c.z - _a.z;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-10) continue;
    triangles.push([
      nx / len, ny / len, nz / len,
      _a.x, _a.y, _a.z,
      _b.x, _b.y, _b.z,
      _c.x, _c.y, _c.z
    ]);
  }
  return triangles;
}

function meshXml(triangles) {
  const vertices = [];
  const faces = [];
  const lookup = new Map();
  function vertex(x, y, z) {
    const key = fmt(x) + "," + fmt(y) + "," + fmt(z);
    let id = lookup.get(key);
    if (id == null) {
      id = vertices.length;
      vertices.push(key);
      lookup.set(key, id);
    }
    return id;
  }
  triangles.forEach(function (tri) {
    const a = vertex(tri[3], tri[4], tri[5]);
    const b = vertex(tri[6], tri[7], tri[8]);
    const c = vertex(tri[9], tri[10], tri[11]);
    if (a !== b && b !== c && a !== c) faces.push(a + " " + b + " " + c);
  });
  const vertexXml = vertices.map(function (key) {
    const p = key.split(",");
    return '<vertex x="' + p[0] + '" y="' + p[1] + '" z="' + p[2] + '"/>';
  });
  const triangleXml = faces.map(function (face) {
    const ids = face.split(" ");
    return '<triangle v1="' + ids[0] + '" v2="' + ids[1] + '" v3="' + ids[2] + '"/>';
  });
  return (
    "<mesh><vertices>" + vertexXml.join("") + "</vertices><triangles>" +
    triangleXml.join("") + "</triangles></mesh>"
  );
}

function recordsFromParts(parts) {
  return parts.map(function (part) {
    const triangles = trianglesFromMesh(part.geometry, part.matrix);
    if (!triangles.length) return null;
    return { name: part.name || "Part", triangles: triangles };
  }).filter(Boolean);
}

export function build3mf(parts) {
  const records = recordsFromParts(parts);
  if (!records.length) throw new Error("Nothing to export yet.");
  const objects = [];
  records.forEach(function (record, index) {
    objects.push(
      '<object id="' + (index + 1) + '" type="model" name="' + xmlEscape(record.name) + '">' +
      meshXml(record.triangles) +
      "</object>"
    );
  });
  let buildId = 1;
  if (records.length > 1) {
    buildId = records.length + 1;
    const components = records.map(function (record, index) {
      return '<component objectid="' + (index + 1) + '"/>';
    }).join("");
    objects.push(
      '<object id="' + buildId + '" type="model" name="' + xmlEscape(records[0].name) + ' assembly">' +
      "<components>" + components + "</components></object>"
    );
  }
  const model =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    '<metadata name="Application">STL Embossing Tool</metadata>' +
    "<resources>" + objects.join("") + "</resources>" +
    '<build><item objectid="' + buildId + '"/></build></model>';
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    "</Types>";
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    "</Relationships>";
  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(model)
  }, { level: 4 });
}

function stlBytes(triangles) {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  triangles.forEach(function (tri) {
    for (let i = 0; i < 12; i++) {
      view.setFloat32(offset, tri[i], true);
      offset += 4;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  });
  return new Uint8Array(buffer);
}

export function buildStlZip(parts) {
  const records = recordsFromParts(parts);
  if (!records.length) throw new Error("Nothing to export yet.");
  const files = {};
  const used = new Set();
  records.forEach(function (record, index) {
    let name = fileSlug(record.name) + ".stl";
    if (used.has(name)) name = fileSlug(record.name) + "-" + (index + 1) + ".stl";
    used.add(name);
    files[name] = stlBytes(record.triangles);
  });
  return zipSync(files, { level: 4 });
}
