import * as THREE from "three";

const EMBED_MM = 0.15;
const OVERLAP_MM = 0.04;

function forgeApi() {
  const api = globalThis.OutlineForge;
  if (!api || !api.build) throw new Error("The outline tool did not load.");
  return api;
}

function clipperLib() {
  const lib = globalThis.ClipperLib;
  if (!lib) throw new Error("The outline tool did not load.");
  return lib;
}

function clamp(value, min, max, fallback) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = fallback;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

function spanOf(paths) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  paths.forEach(function (path) {
    path.forEach(function (point) {
      if (point.X < minX) minX = point.X;
      if (point.Y < minY) minY = point.Y;
      if (point.X > maxX) maxX = point.X;
      if (point.Y > maxY) maxY = point.Y;
    });
  });
  if (!Number.isFinite(minX)) return 0;
  return maxX - minX + (maxY - minY);
}

function rawOffset(paths, delta) {
  const ClipperLib = clipperLib();
  const offset = new ClipperLib.ClipperOffset(2, Math.round(0.05 * forgeApi().SCALE));
  offset.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const solution = new ClipperLib.Paths();
  offset.Execute(solution, delta);
  return solution || [];
}

function growPaths(paths, deltaMm) {
  const delta = Math.round(deltaMm * forgeApi().SCALE);
  if (!delta || !paths.length) return paths;
  const grown = rawOffset(paths, delta);
  const flipped = rawOffset(paths, -delta);
  const chosen = spanOf(grown) >= spanOf(flipped) ? grown : flipped;
  return chosen.length ? chosen : paths;
}

function scalePaths(paths, scale) {
  if (scale === 1) return paths;
  return paths.map(function (path) {
    return path.map(function (point) {
      return { X: Math.round(point.X * scale), Y: Math.round(point.Y * scale) };
    });
  });
}

function ringArea(pts) {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return area / 2;
}

function contains(pts, x, y) {
  let hits = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = pts[i].y;
    const yj = pts[j].y;
    if ((yi > y) !== (yj > y)) {
      const xint = ((pts[j].x - pts[i].x) * (y - yi)) / (yj - yi) + pts[i].x;
      if (x < xint) hits++;
    }
  }
  return hits % 2 === 1;
}

function candidatePoints(pts) {
  const points = [];
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    cx += pts[i].x;
    cy += pts[i].y;
  }
  points.push({ x: cx / pts.length, y: cy / pts.length });
  const step = Math.max(1, Math.floor(pts.length / 32));
  const nudges = [0.06, 0.2, 0.6];
  for (let i = 0; i < pts.length; i += step) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let n = 0; n < nudges.length; n++) {
      const nudge = nudges[n];
      points.push({ x: mx - (dy / len) * nudge, y: my + (dx / len) * nudge });
      points.push({ x: mx + (dy / len) * nudge, y: my - (dx / len) * nudge });
    }
  }
  return points;
}

function ownProbe(item, items) {
  const candidates = candidatePoints(item.pts);
  for (let i = 0; i < candidates.length; i++) {
    const point = candidates[i];
    if (!contains(item.pts, point.x, point.y)) continue;
    let insideSmaller = false;
    for (let j = 0; j < items.length; j++) {
      const other = items[j];
      if (other === item || other.area >= item.area) continue;
      if (contains(other.pts, point.x, point.y)) {
        insideSmaller = true;
        break;
      }
    }
    if (!insideSmaller) return point;
  }
  return interiorPoint(item.pts);
}

function interiorPoint(pts) {
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    cx += pts[i].x;
    cy += pts[i].y;
  }
  cx /= pts.length;
  cy /= pts.length;
  if (contains(pts, cx, cy)) return { x: cx, y: cy };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nudge = Math.max(len * 0.05, 1e-4);
    const left = { x: mx - (dy / len) * nudge, y: my + (dx / len) * nudge };
    if (contains(pts, left.x, left.y)) return left;
    const right = { x: mx + (dy / len) * nudge, y: my - (dx / len) * nudge };
    if (contains(pts, right.x, right.y)) return right;
  }
  return { x: cx, y: cy };
}

function thinRing(pts, max) {
  if (pts.length <= max) return pts;
  const out = [];
  const step = pts.length / max;
  for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * step)]);
  return out;
}

function pathsToRings(paths) {
  const scale = forgeApi().SCALE;
  const rings = [];
  paths.forEach(function (path) {
    if (!path || path.length < 3) return;
    const pts = [];
    for (let i = 0; i < path.length; i++) {
      const x = path[i].X / scale;
      const y = -path[i].Y / scale;
      const prev = pts[pts.length - 1];
      if (prev && Math.abs(prev.x - x) < 1e-5 && Math.abs(prev.y - y) < 1e-5) continue;
      pts.push({ x: x, y: y });
    }
    if (pts.length > 2) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (Math.abs(first.x - last.x) < 1e-5 && Math.abs(first.y - last.y) < 1e-5) pts.pop();
    }
    if (pts.length >= 3 && Math.abs(ringArea(pts)) > 0.01) rings.push(thinRing(pts, 700));
  });
  return rings;
}

function ensureWinding(pts, ccw) {
  const positive = ringArea(pts) > 0;
  if (positive !== ccw) return pts.slice().reverse();
  return pts;
}

function addRing(path, pts, ccw) {
  const ring = ensureWinding(pts, ccw);
  path.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i++) path.lineTo(ring[i].x, ring[i].y);
  path.closePath();
}

function shapesFromRings(rings) {
  const items = rings.map(function (pts) {
    return { pts: pts, depth: 0, probe: null };
  });
  items.forEach(function (item) {
    item.area = Math.abs(ringArea(item.pts));
  });
  items.forEach(function (item) {
    item.probe = ownProbe(item, items);
  });
  items.forEach(function (item) {
    let depth = 0;
    for (let i = 0; i < items.length; i++) {
      const other = items[i];
      if (other === item || other.area <= item.area) continue;
      if (contains(other.pts, item.probe.x, item.probe.y)) depth++;
    }
    item.depth = depth;
  });
  const shapes = [];
  items.forEach(function (outer) {
    if (outer.depth % 2 !== 0) return;
    const shape = new THREE.Shape();
    addRing(shape, outer.pts, true);
    items.forEach(function (hole) {
      if (hole.depth !== outer.depth + 1) return;
      if (!contains(outer.pts, hole.probe.x, hole.probe.y)) return;
      const insideDeeperSolid = items.some(function (mid) {
        return mid.depth > outer.depth &&
          mid.depth % 2 === 0 &&
          contains(outer.pts, mid.probe.x, mid.probe.y) &&
          contains(mid.pts, hole.probe.x, hole.probe.y);
      });
      if (insideDeeperSolid) return;
      const path = new THREE.Path();
      addRing(path, hole.pts, false);
      shape.holes.push(path);
    });
    shapes.push(shape);
  });
  return shapes;
}

function extrude(shapes, depth) {
  if (!shapes.length) return null;
  let geometry;
  try {
    geometry = new THREE.ExtrudeGeometry(shapes, {
      depth: depth,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 1
    });
  } catch (err) {
    throw new Error("Could not build a solid from that shape.");
  }
  const position = geometry.getAttribute("position");
  if (!position || position.count < 3) {
    geometry.dispose();
    throw new Error("Could not build a solid from that shape.");
  }
  geometry.computeVertexNormals();
  return geometry;
}

function centerPair(letters, outline, zShift) {
  letters.computeBoundingBox();
  const box = letters.boundingBox.clone();
  if (outline) {
    outline.computeBoundingBox();
    box.union(outline.boundingBox);
  }
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  letters.translate(-cx, -cy, zShift);
  if (outline) outline.translate(-cx, -cy, zShift);
  return {
    lettersGeo: letters,
    outlineGeo: outline,
    width: box.max.x - box.min.x,
    height: box.max.y - box.min.y
  };
}

export function fitContours(contours, longestMm) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  contours.forEach(function (ring) {
    ring.forEach(function (point) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    });
  });
  const longest = Math.max(maxX - minX, maxY - minY);
  if (!(longest > 0)) throw new Error("That SVG has no filled shape.");
  const scale = longestMm / longest;
  return contours.map(function (ring) {
    return ring.map(function (point) {
      return { x: (point.x - minX) * scale, y: (point.y - minY) * scale };
    });
  });
}

function artworkPaths(spec) {
  const api = forgeApi();
  const rim = clamp(spec.rimMm, 0, 80, 1.2);
  const corner = clamp(spec.cornerMm, 0, 80, 0.6);
  const size = clamp(spec.sizeMm, 0.5, 1000, spec.kind === "svg" ? 40 : 16);
  if (spec.kind === "svg") {
    if (!spec.sourceContours || !spec.sourceContours.length) {
      throw new Error("That SVG has no filled shape.");
    }
    const built = api.buildContours(fitContours(spec.sourceContours, size), {
      rimMm: rim,
      cornerMm: corner
    });
    return { letters: built.letters, rim: rim > 0 ? built.rim : [] };
  }
  if (!spec.font) throw new Error("Choose a font first.");
  const cap = 20;
  const built = api.build(spec.font, {
    text: spec.text,
    rimMm: rim * (cap / size),
    cornerMm: Math.min(corner, rim) * (cap / size),
    separationMm: 0,
    lineSpacingMm: 0,
    align: "center"
  });
  const scale = size / cap;
  return {
    letters: scalePaths(built.letters, scale),
    rim: rim > 0 ? scalePaths(built.rim || [], scale) : []
  };
}

export function buildDecalGeometry(spec) {
  const raise = clamp(spec.raiseMm, 0.2, 80, 0.4);
  const flush = !!spec.flush;
  const paths = artworkPaths(spec);
  let letters = paths.letters;
  if (!letters || !letters.length) throw new Error("Could not build that shape.");
  if (paths.rim && paths.rim.length) letters = growPaths(letters, OVERLAP_MM);
  const letterShapes = shapesFromRings(pathsToRings(letters));
  const outlineShapes = paths.rim && paths.rim.length ? shapesFromRings(pathsToRings(paths.rim)) : [];
  if (!letterShapes.length) throw new Error("Could not build that shape.");
  const depth = flush ? raise : raise + EMBED_MM;
  const zShift = flush ? -raise : -EMBED_MM;
  const letterGeo = extrude(letterShapes, depth);
  const outlineGeo = outlineShapes.length ? extrude(outlineShapes, depth) : null;
  return centerPair(letterGeo, outlineGeo, zShift);
}
