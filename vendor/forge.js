(function (root) {
  var SCALE = 1000;

  function capHeightUnits(font) {
    var fromOs2 = font.tables.os2 && font.tables.os2.sCapHeight;
    if (fromOs2 > 0) return fromOs2;
    var glyph = font.charToGlyph("H");
    var path = glyph.getPath(0, 0, font.unitsPerEm);
    var minY = Infinity;
    var maxY = -Infinity;
    path.commands.forEach(function (cmd) {
      if (typeof cmd.y === "number") {
        if (cmd.y < minY) minY = cmd.y;
        if (cmd.y > maxY) maxY = cmd.y;
      }
    });
    if (maxY > minY) return maxY - minY;
    return font.unitsPerEm * 0.7;
  }

  function pointLineDist(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = Math.hypot(dx, dy);
    if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
  }

  function mid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function flattenCubic(p0, p1, p2, p3, tol, out, depth) {
    if (depth > 16 || (pointLineDist(p1, p0, p3) <= tol && pointLineDist(p2, p0, p3) <= tol)) {
      out.push(p3);
      return;
    }
    var p01 = mid(p0, p1);
    var p12 = mid(p1, p2);
    var p23 = mid(p2, p3);
    var p012 = mid(p01, p12);
    var p123 = mid(p12, p23);
    var p0123 = mid(p012, p123);
    flattenCubic(p0, p01, p012, p0123, tol, out, depth + 1);
    flattenCubic(p0123, p123, p23, p3, tol, out, depth + 1);
  }

  function flattenQuad(p0, p1, p2, tol, out, depth) {
    if (depth > 16 || pointLineDist(p1, p0, p2) <= tol) {
      out.push(p2);
      return;
    }
    var p01 = mid(p0, p1);
    var p12 = mid(p1, p2);
    var p012 = mid(p01, p12);
    flattenQuad(p0, p01, p012, tol, out, depth + 1);
    flattenQuad(p012, p12, p2, tol, out, depth + 1);
  }

  function toScaled(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var X = Math.round(pts[i].x * SCALE);
      var Y = Math.round(pts[i].y * SCALE);
      var prev = out[out.length - 1];
      if (prev && prev.X === X && prev.Y === Y) continue;
      out.push({ X: X, Y: Y });
    }
    if (out.length > 1) {
      var first = out[0];
      var last = out[out.length - 1];
      if (first.X === last.X && first.Y === last.Y) out.pop();
    }
    return out;
  }

  function signedArea(path) {
    var a = 0;
    for (var i = 0, j = path.length - 1; i < path.length; j = i++) {
      a += path[j].X * path[i].Y - path[i].X * path[j].Y;
    }
    return a / 2;
  }

  function pathToContours(path, toleranceMm) {
    var contours = [];
    var pts = [];
    var cx = 0;
    var cy = 0;
    var sx = 0;
    var sy = 0;
    var commands = path.commands;
    for (var i = 0; i < commands.length; i++) {
      var cmd = commands[i];
      if (cmd.type === "M") {
        if (pts.length) contours.push(pts);
        pts = [{ x: cmd.x, y: cmd.y }];
        cx = sx = cmd.x;
        cy = sy = cmd.y;
      } else if (cmd.type === "L") {
        pts.push({ x: cmd.x, y: cmd.y });
        cx = cmd.x;
        cy = cmd.y;
      } else if (cmd.type === "C") {
        flattenCubic(
          { x: cx, y: cy },
          { x: cmd.x1, y: cmd.y1 },
          { x: cmd.x2, y: cmd.y2 },
          { x: cmd.x, y: cmd.y },
          toleranceMm,
          pts,
          0
        );
        cx = cmd.x;
        cy = cmd.y;
      } else if (cmd.type === "Q") {
        flattenQuad(
          { x: cx, y: cy },
          { x: cmd.x1, y: cmd.y1 },
          { x: cmd.x, y: cmd.y },
          toleranceMm,
          pts,
          0
        );
        cx = cmd.x;
        cy = cmd.y;
      } else if (cmd.type === "Z") {
        if (pts.length) contours.push(pts);
        pts = [];
        cx = sx;
        cy = sy;
      }
    }
    if (pts.length) contours.push(pts);
    return contours
      .map(toScaled)
      .filter(function (contour) {
        return contour.length >= 3 && Math.abs(signedArea(contour)) > 1;
      });
  }

  function measureLine(font, line, fontSize, extra) {
    var glyphs = font.stringToGlyphs(line);
    var scale = fontSize / font.unitsPerEm;
    var width = 0;
    for (var i = 0; i < glyphs.length; i++) {
      if (i > 0) width += font.getKerningValue(glyphs[i - 1], glyphs[i]) * scale;
      width += glyphs[i].advanceWidth * scale;
      if (i < glyphs.length - 1) width += extra;
    }
    return { glyphs: glyphs, width: width, scale: scale };
  }

  function layoutGlyphs(font, text, fontSize, extra, lineSpacing, align) {
    var tracking = Number(extra) || 0;
    var leading = Number(lineSpacing) || 0;
    var mode = align === "left" || align === "right" ? align : "center";
    var lines = text.split(/\r?\n/);
    var ascent = (font.ascender / font.unitsPerEm) * fontSize;
    var descent = Math.abs(font.descender / font.unitsPerEm) * fontSize;
    var lineGapUnits = (font.tables.hhea && font.tables.hhea.lineGap) || 0;
    var lineGap = (lineGapUnits / font.unitsPerEm) * fontSize;
    var lineAdvance = ascent + descent + Math.max(lineGap, fontSize * 0.12) + leading;
    if (lineAdvance < 1) lineAdvance = 1;
    var measured = lines.map(function (line) {
      return line.trim() ? measureLine(font, line, fontSize, tracking) : { glyphs: [], width: 0 };
    });
    var maxWidth = 0;
    measured.forEach(function (line) {
      if (line.width > maxWidth) maxWidth = line.width;
    });
    var glyphs = [];
    lines.forEach(function (line, index) {
      if (!line.trim()) return;
      var placed = measured[index];
      var x = mode === "left" ? 0 : mode === "right" ? maxWidth - placed.width : (maxWidth - placed.width) / 2;
      var baseline = ascent + index * lineAdvance;
      for (var i = 0; i < placed.glyphs.length; i++) {
        if (i > 0) x += font.getKerningValue(placed.glyphs[i - 1], placed.glyphs[i]) * placed.scale;
        var path = placed.glyphs[i].getPath(x, baseline, fontSize);
        var contours = pathToContours(path, 0.02);
        if (contours.length) glyphs.push(contours);
        x += placed.glyphs[i].advanceWidth * placed.scale;
        if (i < placed.glyphs.length - 1) x += tracking;
      }
    });
    return glyphs;
  }

  function clean(paths, distance) {
    var cleaned = ClipperLib.Clipper.CleanPolygons(paths, distance == null ? 2 : distance) || [];
    return cleaned.filter(function (path) {
      return path && path.length >= 3;
    });
  }

  function booleanOp(type, subject, clip) {
    var clipper = new ClipperLib.Clipper();
    clipper.StrictlySimple = true;
    clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
    if (clip) clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
    var solution = new ClipperLib.Paths();
    var ok = clipper.Execute(
      type,
      solution,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero
    );
    if (!ok) throw new Error("Could not combine the letter shapes.");
    return clean(solution);
  }

  function unionContours(contours, fillType) {
    var fill = fillType || ClipperLib.PolyFillType.pftNonZero;
    var clipper = new ClipperLib.Clipper();
    clipper.AddPaths(contours, ClipperLib.PolyType.ptSubject, true);
    var solution = new ClipperLib.Paths();
    var ok = clipper.Execute(ClipperLib.ClipType.ctUnion, solution, fill, fill);
    if (!ok) throw new Error("Could not combine the letter shapes.");
    return clean(solution);
  }

  function walkContours(node, outers, holes) {
    var contour = node.Contour();
    if (contour && contour.length >= 3) {
      if (node.IsHole()) holes.push(contour);
      else outers.push(contour);
    }
    var children = node.Childs();
    for (var i = 0; i < children.length; i++) walkContours(children[i], outers, holes);
  }

  function splitOutersAndHoles(paths) {
    var clipper = new ClipperLib.Clipper();
    clipper.StrictlySimple = true;
    clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
    var tree = new ClipperLib.PolyTree();
    var ok = clipper.Execute(
      ClipperLib.ClipType.ctUnion,
      tree,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero
    );
    if (!ok) throw new Error("Could not outline the letters.");
    var outers = [];
    var holes = [];
    var children = tree.Childs();
    for (var i = 0; i < children.length; i++) walkContours(children[i], outers, holes);
    return { outers: clean(outers), holes: clean(holes) };
  }

  function unionAll(a, b) {
    if (!a.length) return b;
    if (!b.length) return a;
    return booleanOp(ClipperLib.ClipType.ctUnion, a, b);
  }

  function boundsOf(paths) {
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    paths.forEach(function (path) {
      path.forEach(function (point) {
        if (point.X < minX) minX = point.X;
        if (point.Y < minY) minY = point.Y;
        if (point.X > maxX) maxX = point.X;
        if (point.Y > maxY) maxY = point.Y;
      });
    });
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function spanOf(paths) {
    if (!paths.length) return 0;
    var bounds = boundsOf(paths);
    return bounds.maxX - bounds.minX + (bounds.maxY - bounds.minY);
  }

  function rawOffset(paths, delta, join) {
    var offset = new ClipperLib.ClipperOffset(2, Math.round(0.05 * SCALE));
    var joinType = join === "miter" ? ClipperLib.JoinType.jtMiter : ClipperLib.JoinType.jtRound;
    offset.AddPaths(paths, joinType, ClipperLib.EndType.etClosedPolygon);
    var solution = new ClipperLib.Paths();
    offset.Execute(solution, delta);
    return solution || [];
  }

  function clonePaths(paths) {
    return paths.map(function (path) {
      return path.map(function (point) {
        return { X: point.X, Y: point.Y };
      });
    });
  }

  function insetPaths(paths, deltaMm, join) {
    var delta = Math.round(deltaMm * SCALE);
    if (delta <= 0) return clonePaths(paths);
    var grown = rawOffset(paths, delta, join);
    var shrunk = rawOffset(paths, -delta, join);
    var chosen = spanOf(shrunk) <= spanOf(grown) ? shrunk : grown;
    return clean(chosen);
  }

  function offsetPaths(paths, deltaMm, join) {
    var delta = Math.round(deltaMm * SCALE);
    if (delta === 0) return clonePaths(paths);
    var expanded = rawOffset(paths, delta, join);
    var flipped = rawOffset(paths, -delta, join);
    var expandedSpan = spanOf(expanded);
    var flippedSpan = spanOf(flipped);
    var chosen = expandedSpan >= flippedSpan ? expanded : flipped;
    if (!chosen.length) throw new Error("Could not build the outline. Use a thinner outline.");
    return clean(chosen);
  }

  function difference(subject, clip) {
    return booleanOp(ClipperLib.ClipType.ctDifference, subject, clip);
  }

  function translate(paths, dx, dy) {
    return paths.map(function (path) {
      return path.map(function (point) {
        return { X: point.X + dx, Y: point.Y + dy };
      });
    });
  }

  function fmtPoint(point) {
    return (point.X / SCALE).toFixed(3) + "," + (point.Y / SCALE).toFixed(3);
  }

  function pathsToD(paths) {
    var parts = [];
    paths.forEach(function (path) {
      if (path.length < 3) return;
      var commands = ["M " + fmtPoint(path[0])];
      for (var i = 1; i < path.length; i++) commands.push("L " + fmtPoint(path[i]));
      commands.push("Z");
      parts.push(commands.join(" "));
    });
    return parts.join("\n");
  }

  function distPointSeg(point, a, b) {
    return pointLineDist(
      { x: point.X, y: point.Y },
      { x: a.X, y: a.Y },
      { x: b.X, y: b.Y }
    );
  }

  function rdp(points, epsilon) {
    if (points.length < 3) return points.slice();
    var first = points[0];
    var last = points[points.length - 1];
    var maxDist = 0;
    var index = 0;
    for (var i = 1; i < points.length - 1; i++) {
      var dist = distPointSeg(points[i], first, last);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist <= epsilon) return [first, last];
    var left = rdp(points.slice(0, index + 1), epsilon);
    var right = rdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }

  function simplifyClosed(path, epsilon) {
    if (!path || path.length < 8) {
      return path ? path.map(function (point) { return { X: point.X, Y: point.Y }; }) : [];
    }
    var start = 0;
    for (var i = 1; i < path.length; i++) {
      var point = path[i];
      var best = path[start];
      if (point.Y < best.Y || (point.Y === best.Y && point.X < best.X)) start = i;
    }
    var rotated = path.slice(start).concat(path.slice(0, start));
    var simple = rdp(rotated.concat([rotated[0]]), epsilon);
    if (simple.length > 1) {
      var a = simple[0];
      var b = simple[simple.length - 1];
      if (a.X === b.X && a.Y === b.Y) simple.pop();
    }
    return simple.length >= 3 ? simple : rotated;
  }

  function simplifyPaths(paths, epsilon) {
    return paths
      .map(function (path) { return simplifyClosed(path, epsilon); })
      .filter(function (path) { return path.length >= 3; });
  }

  function withSign(paths, positive) {
    return paths.map(function (path) {
      var copy = path.map(function (point) { return { X: point.X, Y: point.Y }; });
      var isPositive = signedArea(copy) >= 0;
      if (isPositive !== positive) copy.reverse();
      return copy;
    });
  }

  function openCorners(paths, radiusMm, maxMm) {
    var radius = Math.max(0, Number(radiusMm) || 0);
    var maxRadius = Math.max(0, Number(maxMm) || 0);
    if (maxRadius > 0 && radius > maxRadius) radius = maxRadius;
    if (!(radius > 0.02) || !paths.length) return paths;
    var bounds = boundsOf(paths);
    var limit = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / SCALE * 0.45;
    if (radius > limit) radius = limit;
    if (!(radius > 0.02)) return paths;
    var eroded = insetPaths(paths, radius, "miter");
    if (!eroded.length) return paths;
    var grown = offsetPaths(eroded, radius, "round");
    if (!grown.length || spanOf(grown) < spanOf(paths) * 0.8) return paths;
    return grown;
  }

  function outlinePlate(outers, rimMm, cornerMm) {
    var rim = Math.max(0, rimMm);
    if (!(rim > 0)) return unionContours(outers);
    var corner = Math.max(0, Number(cornerMm) || 0);
    var plate = offsetPaths(outers, rim, "miter");
    plate = unionContours(plate);
    if (corner > 0.02) plate = openCorners(plate, corner, rim);
    plate = simplifyPaths(plate, Math.round(0.03 * SCALE));
    return unionContours(plate);
  }

  function insetOutline(paths, rimMm, cornerMm) {
    var rim = Math.max(0, rimMm);
    if (!(rim > 0) || !paths.length) return [];
    var inset = insetPaths(paths, rim, "miter");
    if (!inset.length) return [];
    var corner = Math.max(0, Number(cornerMm) || 0);
    if (corner > 0.02) inset = openCorners(inset, corner, rim);
    return inset;
  }

  function weldPlates(plates) {
    var paths = [];
    plates.forEach(function (path) {
      if (path && path.length >= 3) paths.push(path);
    });
    if (paths.length <= 1) return paths;
    var clipper = new ClipperLib.Clipper();
    clipper.StrictlySimple = true;
    clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
    var solution = new ClipperLib.Paths();
    var ok = clipper.Execute(
      ClipperLib.ClipType.ctUnion,
      solution,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero
    );
    if (!ok) throw new Error("Could not weld the outlines.");
    return clean(solution);
  }

  function pieceFromLetters(letters, rimMm, cornerMm) {
    if (!(rimMm > 0)) {
      return { letters: letters, plates: [] };
    }
    var parts = splitOutersAndHoles(letters);
    var edge = Math.round(0.03 * SCALE);
    var outers = simplifyPaths(parts.outers, edge);
    var holes = simplifyPaths(parts.holes, edge);
    if (!outers.length) throw new Error("Could not build the letter shapes.");
    var plate = outlinePlate(outers, rimMm, cornerMm);
    if (!plate.length) throw new Error("The outline disappeared. Use a thinner outline.");
    var openCenters = holes.length ? insetOutline(holes, rimMm, cornerMm) : [];
    return {
      letters: withSign(outers, true).concat(withSign(holes, false)),
      plates: plate,
      outers: outers,
      holes: holes,
      openCenters: openCenters
    };
  }

  function svgDocument(letters, outline, width, height) {
    var w = width.toFixed(3);
    var h = height.toFixed(3);
    var outlineD = pathsToD(outline);
    var outlineGroup = outlineD
      ? '  <g id="outline"><path fill="#d24b24" fill-rule="nonzero" d="' + outlineD + '"/></g>\n'
      : "";
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + 'mm" height="' + h + 'mm" viewBox="0 0 ' + w + " " + h + '">\n' +
      outlineGroup +
      '  <g id="letters"><path fill="#111111" fill-rule="nonzero" d="' + pathsToD(letters) + '"/></g>\n' +
      "</svg>\n"
    );
  }

  var CAP_MM = 20;

  function build(font, options) {
    var text = String(options.text || "");
    var rimMm = Number(options.rimMm);
    var separationMm = Number(options.separationMm);
    var cornerMm = Number(options.cornerMm);
    if (!isFinite(separationMm)) separationMm = 0;
    if (separationMm < -30) separationMm = -30;
    if (separationMm > 40) separationMm = 40;
    if (!(cornerMm >= 0)) cornerMm = 1.6;
    if (!text.trim()) throw new Error("Type something first.");
    if (text.length > 200) throw new Error("Keep the text under 200 characters.");
    if (!(rimMm >= 0)) throw new Error("Outline thickness has to be 0 or more.");
    if (rimMm > CAP_MM) throw new Error("That outline is thicker than the letters. Use a thinner outline.");

    var lineSpacingMm = Number(options.lineSpacingMm);
    var align = options.align === "left" || options.align === "right" ? options.align : "center";
    if (!isFinite(lineSpacingMm)) lineSpacingMm = 0;
    if (lineSpacingMm < -40) lineSpacingMm = -40;
    if (lineSpacingMm > 80) lineSpacingMm = 80;

    var fontSize = (CAP_MM * font.unitsPerEm) / capHeightUnits(font);
    var glyphs = layoutGlyphs(font, text, fontSize, separationMm, lineSpacingMm, align);
    if (!glyphs.length) throw new Error("That text has no outlines in this font.");

    if (glyphs.length === 1) {
      var alone = unionContours(glyphs[0]);
      if (!alone.length) throw new Error("Could not build the letter shapes.");
      return finish(alone, rimMm, cornerMm);
    }

    var pieces = [];
    glyphs.forEach(function (contours) {
      var letters = unionContours(contours);
      if (!letters.length) return;
      pieces.push(pieceFromLetters(letters, rimMm, cornerMm));
    });
    if (!pieces.length) throw new Error("Could not build the letter shapes.");
    return finishPieces(pieces, rimMm, cornerMm);
  }

  function pointInContour(pts, x, y) {
    var hits = 0;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var yi = pts[i].y;
      var yj = pts[j].y;
      if ((yi > y) !== (yj > y)) {
        var xint = ((pts[j].x - pts[i].x) * (y - yi)) / (yj - yi) + pts[i].x;
        if (x < xint) hits++;
      }
    }
    return hits % 2 === 1;
  }

  function contourArea(pts) {
    var area = 0;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    }
    return area / 2;
  }

  function probeInside(pts, contours) {
    var candidates = [];
    var cx = 0;
    var cy = 0;
    for (var i = 0; i < pts.length; i++) {
      cx += pts[i].x;
      cy += pts[i].y;
    }
    candidates.push({ x: cx / pts.length, y: cy / pts.length });
    var step = Math.max(1, Math.floor(pts.length / 24));
    var fractions = [0.04, 0.18, 0.5];
    for (var n = 0; n < pts.length; n += step) {
      var a = pts[n];
      var b = pts[(n + 1) % pts.length];
      var mx = (a.x + b.x) / 2;
      var my = (a.y + b.y) / 2;
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len = Math.hypot(dx, dy) || 1;
      for (var k = 0; k < fractions.length; k++) {
        var nudge = Math.max(len * fractions[k], 1e-4);
        candidates.push({ x: mx - (dy / len) * nudge, y: my + (dx / len) * nudge });
        candidates.push({ x: mx + (dy / len) * nudge, y: my - (dx / len) * nudge });
      }
    }
    var mine = Math.abs(contourArea(pts));
    for (var c = 0; c < candidates.length; c++) {
      var point = candidates[c];
      if (!pointInContour(pts, point.x, point.y)) continue;
      var blocked = false;
      for (var j = 0; j < contours.length; j++) {
        var other = contours[j];
        if (other === pts || Math.abs(contourArea(other)) >= mine) continue;
        if (pointInContour(other, point.x, point.y)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) return point;
    }
    return candidates[0];
  }

  function normalizeWindings(contours) {
    var probes = contours.map(function (pts) { return probeInside(pts, contours); });
    return contours.map(function (pts, index) {
      var depth = 0;
      for (var i = 0; i < contours.length; i++) {
        if (i !== index && pointInContour(contours[i], probes[index].x, probes[index].y)) depth++;
      }
      var positive = contourArea(pts) > 0;
      if (positive !== (depth % 2 === 0)) return pts.slice().reverse();
      return pts;
    });
  }

  function contoursToPaths(contours) {
    var paths = [];
    contours.forEach(function (pts) {
      var path = [];
      for (var i = 0; i < pts.length; i++) {
        var point = { X: Math.round(pts[i].x * SCALE), Y: Math.round(pts[i].y * SCALE) };
        var prev = path[path.length - 1];
        if (prev && prev.X === point.X && prev.Y === point.Y) continue;
        path.push(point);
      }
      if (path.length > 2) {
        var first = path[0];
        var last = path[path.length - 1];
        if (first.X === last.X && first.Y === last.Y) path.pop();
      }
      if (path.length >= 3) paths.push(path);
    });
    return paths;
  }

  function buildContours(contours, options) {
    var rimMm = Number(options.rimMm);
    var cornerMm = Number(options.cornerMm);
    if (!(cornerMm >= 0)) cornerMm = 1.6;
    if (!contours || !contours.length) throw new Error("That image has no shape to outline.");
    if (!(rimMm >= 0)) throw new Error("Outline thickness has to be 0 or more.");
    if (rimMm > 40) throw new Error("That outline is thicker than the image. Use a thinner outline.");
    var letters = unionContours(
      contoursToPaths(normalizeWindings(contours)),
      ClipperLib.PolyFillType.pftNonZero
    );
    if (!letters.length) throw new Error("That image has no shape to outline.");
    return finish(letters, rimMm, cornerMm);
  }

  function placedResult(shared, outline) {
    var all = outline.length ? shared.concat(outline) : shared;
    var bounds = boundsOf(all);
    var dx = -bounds.minX;
    var dy = -bounds.minY;
    var width = (bounds.maxX - bounds.minX) / SCALE;
    var height = (bounds.maxY - bounds.minY) / SCALE;
    var letters = translate(shared, dx, dy);
    var rim = translate(outline, dx, dy);
    return {
      svg: svgDocument(letters, rim, width, height),
      width: width,
      height: height,
      letters: letters,
      rim: rim
    };
  }

  function finishPieces(pieces, rimMm, cornerMm) {
    var letters = [];
    var plates = [];
    pieces.forEach(function (piece) {
      letters = letters.concat(piece.letters);
      if (piece.plates) plates = plates.concat(piece.plates);
    });
    if (!letters.length) throw new Error("Could not build the letter shapes.");

    var shared = unionContours(letters);
    if (!shared.length) throw new Error("Could not build the letter shapes.");
    var outline = [];
    if (rimMm > 0) {
      var parts = splitOutersAndHoles(shared);
      var outers = parts.outers;
      var holes = parts.holes;
      if (!outers.length) throw new Error("Could not build the letter shapes.");
      shared = withSign(outers, true).concat(withSign(holes, false));
      var welded = weldPlates(plates);
      var plateParts = splitOutersAndHoles(welded);
      if (!plateParts.outers.length) throw new Error("The outline disappeared. Use a thinner outline.");
      var openCenters = holes.length ? insetOutline(holes, rimMm, cornerMm) : [];
      outline = withSign(plateParts.outers, true).concat(withSign(plateParts.holes, false));
      outline = outline.concat(withSign(outers, false));
      if (holes.length) {
        outline = outline.concat(withSign(holes, true));
        if (openCenters.length) outline = outline.concat(withSign(openCenters, false));
      }
    }

    return placedResult(shared, outline);
  }

  function finish(letters, rimMm, cornerMm) {
    var outline = [];
    var shared = letters;
    if (rimMm > 0) {
      var parts = splitOutersAndHoles(letters);
      var edge = Math.round(0.03 * SCALE);
      var outers = simplifyPaths(parts.outers, edge);
      var holes = simplifyPaths(parts.holes, edge);
      if (!outers.length) throw new Error("Could not build the letter shapes.");
      shared = withSign(outers, true).concat(withSign(holes, false));

      var plate = outlinePlate(outers, rimMm, cornerMm);
      var openCenters = holes.length ? insetOutline(holes, rimMm, cornerMm) : [];
      if (plate.length) {
        outline = withSign(plate, true).concat(withSign(outers, false));
        if (holes.length) {
          outline = outline.concat(withSign(holes, true));
          if (openCenters.length) outline = outline.concat(withSign(openCenters, false));
        }
      }
      if (!outline.length) {
        throw new Error("The outline disappeared. Use a thinner outline.");
      }
    }

    return placedResult(shared, outline);
  }

  root.OutlineForge = { build: build, buildContours: buildContours, SCALE: SCALE };
})(typeof globalThis !== "undefined" ? globalThis : this);
