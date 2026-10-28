const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");

const root = path.resolve(__dirname);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".stl": "model/stl",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".ttc": "font/collection"
};

function isInsideRoot(file) {
  return file === root || file.startsWith(root + path.sep);
}

let installedFonts = null;

function cleanFontName(name) {
  return String(name).replace(/\s*\((TrueType|OpenType|All res)\)$/i, "").trim();
}

function readInstalledFonts() {
  if (installedFonts) return Promise.resolve(installedFonts);
  const script = [
    "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
    "$roots = @('HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts')",
    "$win = Join-Path $env:WINDIR 'Fonts'",
    "$seen = @{}",
    "$list = foreach ($root in $roots) {",
    "  if (-not (Test-Path $root)) { continue }",
    "  $item = Get-ItemProperty $root",
    "  foreach ($prop in $item.PSObject.Properties) {",
    "    if ($prop.Name -match '^PS') { continue }",
    "    $file = [string]$prop.Value",
    "    if (-not $file) { continue }",
    "    if (-not [System.IO.Path]::IsPathRooted($file)) { $file = Join-Path $win $file }",
    "    $key = $file.ToLower()",
    "    if ($seen.ContainsKey($key)) { continue }",
    "    if (-not (Test-Path -LiteralPath $file)) { continue }",
    "    $seen[$key] = $true",
    "    [PSCustomObject]@{ name = $prop.Name; file = $file }",
    "  }",
    "}",
    "$list | ConvertTo-Json -Compress"
  ].join("; ");
  return new Promise(function (resolve, reject) {
    execFile(
      "powershell",
      ["-NoProfile", "-Command", script],
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      function (err, stdout) {
        if (err) {
          reject(err);
          return;
        }
        let parsed = [];
        const text = String(stdout || "").replace(/^\uFEFF/, "").trim();
        if (text) {
          parsed = JSON.parse(text);
          if (!Array.isArray(parsed)) parsed = [parsed];
        }
        const fonts = parsed
          .filter(function (font) {
            return font && font.file && font.name;
          })
          .map(function (font) {
            return { name: cleanFontName(font.name), file: font.file };
          })
          .sort(function (a, b) {
            return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          });
        const counts = {};
        fonts.forEach(function (font) {
          counts[font.name] = (counts[font.name] || 0) + 1;
        });
        fonts.forEach(function (font) {
          if (counts[font.name] > 1) font.name += " (" + path.basename(font.file) + ")";
        });
        installedFonts = fonts;
        resolve(fonts);
      }
    );
  });
}

function listen(port) {
  const server = http.createServer(function (req, res) {
    let pathname = "/";
    try {
      pathname = new URL(req.url, "http://127.0.0.1").pathname;
    } catch (err) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }
    if (pathname === "/api/fonts") {
      readInstalledFonts().then(function (fonts) {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        });
        res.end(JSON.stringify(fonts.map(function (font, index) {
          return { id: String(index), name: font.name };
        })));
      }).catch(function () {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Could not read the installed fonts.");
      });
      return;
    }
    if (pathname.indexOf("/api/font/") === 0) {
      const id = Number(pathname.slice("/api/font/".length));
      readInstalledFonts().then(function (fonts) {
        const font = fonts[id];
        if (!font) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        fs.readFile(font.file, function (err, data) {
          if (err) {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          const ext = path.extname(font.file).toLowerCase();
          res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
          res.end(data);
        });
      }).catch(function () {
        res.writeHead(500);
        res.end("Could not read the installed fonts.");
      });
      return;
    }
    const rel = decodeURIComponent(pathname).replace(/^[/\\]+/, "") || "index.html";
    const file = path.resolve(root, rel);
    if (!isInsideRoot(file) || rel.split(/[/\\]/).includes("..") || rel.startsWith(".git")) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(file, function (err, data) {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
      res.end(data);
    });
  });

  server.on("error", function (err) {
    if (err.code === "EADDRINUSE") {
      listen(port + 1);
      return;
    }
    console.error(err.message);
    process.exit(1);
  });

  server.listen(port, "127.0.0.1", function () {
    const url = "http://127.0.0.1:" + port;
    console.log("Surface Outline is running at " + url);
    console.log("Close this window to stop it.");
    if (process.env.SURFACE_OUTLINE_OPEN !== "0") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    }
  });
}

listen(4183);
