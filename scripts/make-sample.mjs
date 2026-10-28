import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { writeFileSync, mkdirSync } from "fs";

const geometry = new THREE.BoxGeometry(60, 40, 20);
geometry.translate(30, 20, 10);
const mesh = new THREE.Mesh(geometry);
const exporter = new STLExporter();
const data = exporter.parse(mesh, { binary: true });
mkdirSync(new URL("../samples/", import.meta.url), { recursive: true });
writeFileSync(new URL("../samples/block.stl", import.meta.url), Buffer.from(data.buffer));
console.log("Wrote samples/block.stl");
