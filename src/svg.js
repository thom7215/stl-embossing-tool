function mapPoint(el, svg, x, y) {
  const point = svg.createSVGPoint();
  point.x = x;
  point.y = y;
  const from = el.getScreenCTM();
  const to = svg.getScreenCTM();
  if (!from || !to) return { x: x, y: y };
  const mapped = point.matrixTransform(from).matrixTransform(to.inverse());
  return { x: mapped.x, y: mapped.y };
}

function thin(pts, max) {
  if (pts.length <= max) return pts;
  const out = [];
  const step = (pts.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

function pathNumbers(chunk) {
  return (chunk.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number).filter(function (n) {
    return Number.isFinite(n);
  });
}

function absoluteSubpaths(d) {
  const re = /([MLHVCSQTAZ])([^MLHVCSQTAZ]*)/gi;
  const subs = [];
  let current = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  function begin(nx, ny) {
    if (current.length) subs.push(current.join(" "));
    x = nx;
    y = ny;
    sx = nx;
    sy = ny;
    current = ["M", nx, ny];
  }
  let match;
  while ((match = re.exec(d))) {
    const raw = match[1];
    const cmd = raw.toUpperCase();
    const rel = raw !== cmd;
    const nums = pathNumbers(match[2]);
    if (cmd === "Z") {
      if (current.length) current.push("Z");
      x = sx;
      y = sy;
      continue;
    }
    const count = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }[cmd];
    if (!count) continue;
    for (let i = 0; i + count <= nums.length; i += count) {
      const a = nums.slice(i, i + count);
      const draw = cmd === "M" && i > 0 ? "L" : cmd;
      if (draw === "M") {
        begin(rel ? x + a[0] : a[0], rel ? y + a[1] : a[1]);
      } else if (draw === "L") {
        x = rel ? x + a[0] : a[0];
        y = rel ? y + a[1] : a[1];
        current.push("L", x, y);
      } else if (draw === "H") {
        x = rel ? x + a[0] : a[0];
        current.push("L", x, y);
      } else if (draw === "V") {
        y = rel ? y + a[0] : a[0];
        current.push("L", x, y);
      } else if (draw === "C") {
        const p = rel ? [x + a[0], y + a[1], x + a[2], y + a[3], x + a[4], y + a[5]] : a.slice();
        current.push("C", p[0], p[1], p[2], p[3], p[4], p[5]);
        x = p[4];
        y = p[5];
      } else if (draw === "S") {
        const p = rel ? [x + a[0], y + a[1], x + a[2], y + a[3]] : a.slice();
        current.push("S", p[0], p[1], p[2], p[3]);
        x = p[2];
        y = p[3];
      } else if (draw === "Q") {
        const p = rel ? [x + a[0], y + a[1], x + a[2], y + a[3]] : a.slice();
        current.push("Q", p[0], p[1], p[2], p[3]);
        x = p[2];
        y = p[3];
      } else if (draw === "T") {
        const nx = rel ? x + a[0] : a[0];
        const ny = rel ? y + a[1] : a[1];
        current.push("T", nx, ny);
        x = nx;
        y = ny;
      } else if (draw === "A") {
        const nx = rel ? x + a[5] : a[5];
        const ny = rel ? y + a[6] : a[6];
        current.push("A", a[0], a[1], a[2], a[3], a[4], nx, ny);
        x = nx;
        y = ny;
      }
    }
  }
  if (current.length) subs.push(current.join(" "));
  return subs;
}

function samplePath(el, svg) {
  const parts = absoluteSubpaths(el.getAttribute("d") || "");
  const contours = [];
  parts.forEach(function (part) {
    const temp = document.createElementNS(svg.namespaceURI, "path");
    temp.setAttribute("d", part);
    svg.appendChild(temp);
    const length = temp.getTotalLength();
    if (!(length > 0.5)) {
      temp.remove();
      return;
    }
    const steps = Math.max(64, Math.min(3600, Math.ceil(length / 0.25)));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const point = temp.getPointAtLength(Math.min(length, (length * i) / steps));
      pts.push(mapPoint(el, svg, point.x, point.y));
    }
    temp.remove();
    if (pts.length >= 3) contours.push(thin(pts, 3600));
  });
  return contours;
}

function shapeContours(el, svg) {
  const tag = el.localName.toLowerCase();
  if (tag === "path") return samplePath(el, svg);
  if (tag === "polygon" || tag === "polyline") {
    const pts = [];
    const nums = (el.getAttribute("points") || "").trim().split(/[\s,]+/);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = Number(nums[i]);
      const y = Number(nums[i + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push(mapPoint(el, svg, x, y));
    }
    return pts.length >= 3 ? [pts] : [];
  }
  if (tag === "rect") {
    const x = Number(el.getAttribute("x") || 0);
    const y = Number(el.getAttribute("y") || 0);
    const w = Number(el.getAttribute("width") || 0);
    const h = Number(el.getAttribute("height") || 0);
    if (!(w > 0) || !(h > 0)) return [];
    return [[
      mapPoint(el, svg, x, y),
      mapPoint(el, svg, x + w, y),
      mapPoint(el, svg, x + w, y + h),
      mapPoint(el, svg, x, y + h)
    ]];
  }
  if (tag === "circle" || tag === "ellipse") {
    const cx = Number(el.getAttribute("cx") || 0);
    const cy = Number(el.getAttribute("cy") || 0);
    const rx = tag === "circle" ? Number(el.getAttribute("r") || 0) : Number(el.getAttribute("rx") || 0);
    const ry = tag === "circle" ? rx : Number(el.getAttribute("ry") || 0);
    if (!(rx > 0) || !(ry > 0)) return [];
    const ring = [];
    const steps = 64;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      ring.push(mapPoint(el, svg, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
    }
    return [ring];
  }
  return [];
}

function fillType(el) {
  const rule = (getComputedStyle(el).fillRule || "nonzero").toLowerCase();
  const ClipperLib = globalThis.ClipperLib;
  if (!ClipperLib) return null;
  return rule === "evenodd" ? ClipperLib.PolyFillType.pftEvenOdd : ClipperLib.PolyFillType.pftNonZero;
}

function cleanRing(path, scale) {
  const pts = [];
  for (let i = 0; i < path.length; i++) {
    const point = { x: path[i].X / scale, y: path[i].Y / scale };
    const prev = pts[pts.length - 1];
    if (prev && Math.abs(prev.x - point.x) < 1e-7 && Math.abs(prev.y - point.y) < 1e-7) continue;
    pts.push(point);
  }
  if (pts.length > 2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.abs(first.x - last.x) < 1e-7 && Math.abs(first.y - last.y) < 1e-7) pts.pop();
  }
  return pts.length >= 3 ? pts : null;
}

function resolveFill(rings, fill) {
  const ClipperLib = globalThis.ClipperLib;
  if (!ClipperLib || fill == null || rings.length < 1) return rings;
  let max = 1;
  rings.forEach(function (ring) {
    ring.forEach(function (point) {
      max = Math.max(max, Math.abs(point.x), Math.abs(point.y));
    });
  });
  const scale = Math.max(1, Math.min(10000, Math.floor(1e8 / max)));
  const paths = [];
  rings.forEach(function (ring) {
    const path = [];
    ring.forEach(function (point) {
      const next = { X: Math.round(point.x * scale), Y: Math.round(point.y * scale) };
      const prev = path[path.length - 1];
      if (!prev || prev.X !== next.X || prev.Y !== next.Y) path.push(next);
    });
    if (path.length > 2) {
      const first = path[0];
      const last = path[path.length - 1];
      if (first.X === last.X && first.Y === last.Y) path.pop();
    }
    if (path.length >= 3) paths.push(path);
  });
  if (!paths.length) return rings;
  const clipper = new ClipperLib.Clipper();
  clipper.StrictlySimple = true;
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  const ok = clipper.Execute(ClipperLib.ClipType.ctUnion, tree, fill, fill);
  if (!ok) return rings;
  const resolved = [];
  function walk(node) {
    let ring = cleanRing(node.Contour() || [], scale);
    if (ring) {
      let area = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        area += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
      }
      if ((area > 0) === !!node.IsHole()) ring = ring.slice().reverse();
      ring.area = area;
      resolved.push(ring);
    }
    const children = node.Childs();
    for (let i = 0; i < children.length; i++) walk(children[i]);
  }
  const roots = tree.Childs();
  for (let i = 0; i < roots.length; i++) walk(roots[i]);
  let maxArea = 0;
  resolved.forEach(function (ring) {
    maxArea = Math.max(maxArea, Math.abs(ring.area));
  });
  const kept = resolved.filter(function (ring) {
    return Math.abs(ring.area) > maxArea * 0.0001;
  });
  kept.forEach(function (ring) { delete ring.area; });
  return kept.length ? kept : rings;
}

function isFilled(el) {
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const fill = style.fill;
  if (!fill || fill === "none" || fill === "rgba(0, 0, 0, 0)") return false;
  const opacity = Number(style.fillOpacity);
  if (Number.isFinite(opacity) && opacity <= 0) return false;
  return true;
}

export function contoursFromSvg(text) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (!doc.documentElement || doc.querySelector("parsererror")) {
    throw new Error("Could not read that SVG.");
  }
  const svg = document.importNode(doc.documentElement, true);
  if (svg.localName.toLowerCase() !== "svg") throw new Error("Could not read that SVG.");
  svg.querySelectorAll("script, foreignObject").forEach(function (node) {
    node.remove();
  });
  if (!svg.getAttribute("width")) svg.setAttribute("width", "800");
  if (!svg.getAttribute("height")) svg.setAttribute("height", "800");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:800px;height:800px;opacity:0;pointer-events:none;z-index:-1";
  host.appendChild(svg);
  document.body.appendChild(host);
  const pieces = [];
  try {
    svg.querySelectorAll("path, polygon, polyline, rect, circle, ellipse").forEach(function (el) {
      if (!isFilled(el)) return;
      const rings = shapeContours(el, svg).filter(function (pts) { return pts.length >= 3; });
      if (!rings.length) return;
      resolveFill(rings, fillType(el)).forEach(function (pts) {
        pieces.push(pts);
      });
    });
  } finally {
    host.remove();
  }
  const ClipperLib = globalThis.ClipperLib;
  const contours = resolveFill(
    pieces,
    ClipperLib ? ClipperLib.PolyFillType.pftNonZero : null
  );
  if (!contours.length) {
    throw new Error("That SVG has no filled shape. Strokes alone are skipped.");
  }
  return contours;
}
