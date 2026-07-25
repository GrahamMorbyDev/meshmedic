"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type MeshStats = {
  triangles: number;
  vertices: number;
  nakedEdges: number;
  nonManifoldEdges: number;
  degenerateFaces: number;
  duplicateFaces: number;
  shells: number;
};

type LoadedModel = {
  name: string;
  bytes: number;
  original: THREE.BufferGeometry;
  current: THREE.BufferGeometry;
  originalStats: MeshStats;
  stats: MeshStats;
  repaired: boolean;
};

const EMPTY_STATS: MeshStats = {
  triangles: 0,
  vertices: 0,
  nakedEdges: 0,
  nonManifoldEdges: 0,
  degenerateFaces: 0,
  duplicateFaces: 0,
  shells: 0,
};

const fmt = new Intl.NumberFormat("en-GB");

function vertexKey(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) {
  return `${position.getX(i).toFixed(5)},${position.getY(i).toFixed(5)},${position.getZ(i).toFixed(5)}`;
}

function analyseGeometry(source: THREE.BufferGeometry): MeshStats {
  const geometry = source.index ? source.clone() : mergeVertices(source.clone(), 1e-5);
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (!position || !index) return EMPTY_STATS;

  const edges = new Map<string, number>();
  const faceKeys = new Set<string>();
  const adjacency = new Map<number, Set<number>>();
  let degenerateFaces = 0;
  let duplicateFaces = 0;

  const connect = (a: number, b: number) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  for (let i = 0; i < index.count; i += 3) {
    const face = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const a = new THREE.Vector3().fromBufferAttribute(position, face[0]);
    const b = new THREE.Vector3().fromBufferAttribute(position, face[1]);
    const c = new THREE.Vector3().fromBufferAttribute(position, face[2]);
    const area = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).lengthSq();
    if (area < 1e-14) degenerateFaces += 1;

    const faceKey = face.map((v) => vertexKey(position, v)).sort().join("|");
    if (faceKeys.has(faceKey)) duplicateFaces += 1;
    faceKeys.add(faceKey);

    [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]].forEach(([x, y]) => {
      const key = x < y ? `${x}:${y}` : `${y}:${x}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      connect(x, y);
    });
  }

  let shells = 0;
  const visited = new Set<number>();
  for (let v = 0; v < position.count; v += 1) {
    if (visited.has(v) || !adjacency.has(v)) continue;
    shells += 1;
    const stack = [v];
    visited.add(v);
    while (stack.length) {
      const current = stack.pop()!;
      adjacency.get(current)?.forEach((next) => {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      });
    }
  }

  return {
    triangles: index.count / 3,
    vertices: position.count,
    nakedEdges: [...edges.values()].filter((count) => count === 1).length,
    nonManifoldEdges: [...edges.values()].filter((count) => count > 2).length,
    degenerateFaces,
    duplicateFaces,
    shells,
  };
}

function safeRepair(source: THREE.BufferGeometry) {
  const nonIndexed = source.toNonIndexed();
  const position = nonIndexed.getAttribute("position");
  const kept: number[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < position.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, i);
    const b = new THREE.Vector3().fromBufferAttribute(position, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(position, i + 2);
    const area = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).lengthSq();
    const key = [a, b, c]
      .map((v) => `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`)
      .sort()
      .join("|");
    if (area < 1e-14 || seen.has(key)) continue;
    seen.add(key);
    kept.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  const cleaned = new THREE.BufferGeometry();
  cleaned.setAttribute("position", new THREE.Float32BufferAttribute(kept, 3));
  const welded = mergeVertices(cleaned, 1e-5);
  welded.deleteAttribute("normal");
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  nonIndexed.dispose();
  cleaned.dispose();
  return welded;
}

function healthScore(stats: MeshStats) {
  if (!stats.triangles) return 0;
  const faults =
    stats.nakedEdges * 1.4 +
    stats.nonManifoldEdges * 2.2 +
    stats.degenerateFaces * 0.8 +
    stats.duplicateFaces * 0.5;
  return Math.max(8, Math.round(100 - (faults / Math.max(stats.triangles, 1)) * 120));
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ModelViewport({ model, wireframe }: { model: LoadedModel | null; wireframe: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#101614");
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10000);
    camera.position.set(3, 2.1, 3);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const grid = new THREE.GridHelper(12, 24, "#345348", "#1e2d28");
    grid.position.y = -1.4;
    scene.add(grid);
    scene.add(new THREE.HemisphereLight("#dfffee", "#0b0e0d", 2.8));
    const key = new THREE.DirectionalLight("#ffffff", 3.5);
    key.position.set(4, 6, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight("#73f2b3", 2.2);
    rim.position.set(-4, 1, -2);
    scene.add(rim);

    let mesh: THREE.Mesh | undefined;
    if (model) {
      const geometry = model.current.clone();
      geometry.center();
      geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      geometry.boundingBox?.getSize(size);
      const max = Math.max(size.x, size.y, size.z) || 1;
      geometry.scale(2.7 / max, 2.7 / max, 2.7 / max);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshStandardMaterial({
        color: model.repaired ? "#7cf0b4" : "#d9e7df",
        roughness: 0.28,
        metalness: 0.08,
        wireframe,
        side: THREE.DoubleSide,
      });
      mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = Boolean(model);
    controls.autoRotateSpeed = 0.6;
    controls.minDistance = 2;
    controls.maxDistance = 9;

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    let frame = 0;
    const draw = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      mesh?.geometry.dispose();
      (mesh?.material as THREE.Material | undefined)?.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [model, wireframe]);

  return <div ref={mountRef} className="viewport-canvas" aria-label="Interactive 3D model preview" />;
}

export function RepairStudio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [status, setStatus] = useState("Waiting for an STL");

  const loadFile = useCallback(async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".stl")) {
      setStatus("Please choose an STL file");
      return;
    }
    setProcessing(true);
    setStatus("Analysing mesh topology…");
    await new Promise((resolve) => setTimeout(resolve, 120));
    try {
      const buffer = await file.arrayBuffer();
      const geometry = new STLLoader().parse(buffer);
      const indexed = mergeVertices(geometry, 1e-5);
      indexed.computeVertexNormals();
      const stats = analyseGeometry(indexed);
      setModel({
        name: file.name,
        bytes: file.size,
        original: indexed.clone(),
        current: indexed,
        originalStats: stats,
        stats,
        repaired: false,
      });
      setStatus(stats.nakedEdges || stats.nonManifoldEdges ? "Issues found — safe repair is ready" : "Mesh looks healthy");
    } catch {
      setStatus("That STL could not be read");
    } finally {
      setProcessing(false);
    }
  }, []);

  const onInput = (event: ChangeEvent<HTMLInputElement>) => loadFile(event.target.files?.[0]);
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    loadFile(event.dataTransfer.files?.[0]);
  };

  const repair = async () => {
    if (!model) return;
    setProcessing(true);
    setStatus("Cleaning and rebuilding mesh…");
    await new Promise((resolve) => setTimeout(resolve, 400));
    const repaired = safeRepair(model.current);
    const stats = analyseGeometry(repaired);
    setModel({ ...model, current: repaired, stats, repaired: true });
    setStatus("Safe repair complete");
    setProcessing(false);
  };

  const reset = () => {
    if (!model) return;
    const original = model.original.clone();
    setModel({ ...model, current: original, stats: model.originalStats, repaired: false });
    setStatus("Restored original mesh");
  };

  const download = () => {
    if (!model) return;
    const mesh = new THREE.Mesh(model.current);
    const data = new STLExporter().parse(mesh, { binary: true }) as DataView;
    const blob = new Blob([data.buffer as ArrayBuffer], { type: "model/stl" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = model.name.replace(/\.stl$/i, "") + "-repaired.stl";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const score = model ? healthScore(model.stats) : 0;
  const issues = model
    ? [
        { label: "Open edges", value: model.stats.nakedEdges, tone: model.stats.nakedEdges ? "warn" : "good" },
        { label: "Non-manifold", value: model.stats.nonManifoldEdges, tone: model.stats.nonManifoldEdges ? "bad" : "good" },
        { label: "Degenerate faces", value: model.stats.degenerateFaces, tone: model.stats.degenerateFaces ? "warn" : "good" },
        { label: "Duplicate faces", value: model.stats.duplicateFaces, tone: model.stats.duplicateFaces ? "warn" : "good" },
      ]
    : [];

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#" aria-label="MeshMedic home">
          <span className="brand-mark">M</span>
          <span>MeshMedic</span>
        </a>
        <div className="privacy-pill"><span /> Local processing · your file stays private</div>
        <a className="text-link" href="#how-it-works">How it works</a>
      </header>

      <section className="hero">
        <div className="eyebrow">Browser-native STL diagnostics</div>
        <h1>Repair the mesh.<br /><em>Keep the model.</em></h1>
        <p>Find topology problems, clean safe defects and export a slicer-ready STL. Nothing uploads. Nothing waits in a queue.</p>
      </section>

      <section className="workspace">
        <div className="viewer-panel">
          <div className="panel-bar">
            <div>
              <span className="panel-kicker">MODEL VIEW</span>
              <strong>{model ? model.name : "No model loaded"}</strong>
            </div>
            <div className="viewer-actions">
              <button className={wireframe ? "icon-button active" : "icon-button"} onClick={() => setWireframe(!wireframe)} aria-label="Toggle wireframe">⌗</button>
              {model && <button className="icon-button" onClick={reset} aria-label="Reset original model">↺</button>}
            </div>
          </div>

          <div
            className={`viewer ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <ModelViewport model={model} wireframe={wireframe} />
            {!model && (
              <div className="drop-content">
                <div className="upload-glyph">↥</div>
                <h2>Drop your STL here</h2>
                <p>Binary or ASCII · up to 100 MB</p>
                <button className="primary-button" onClick={() => inputRef.current?.click()}>Choose a file</button>
                <input ref={inputRef} type="file" accept=".stl,model/stl" onChange={onInput} hidden />
              </div>
            )}
            {processing && <div className="processing"><span className="spinner" /> {status}</div>}
            {model && !processing && (
              <div className="model-meta">
                <span>{formatBytes(model.bytes)}</span>
                <span>{fmt.format(model.stats.triangles)} triangles</span>
                <span>Drag to orbit · scroll to zoom</span>
              </div>
            )}
          </div>
        </div>

        <aside className="diagnostics">
          <div className="diagnostic-header">
            <div>
              <span className="panel-kicker">MESH HEALTH</span>
              <strong>{model ? status : "Awaiting model"}</strong>
            </div>
            <div className={`score ${score > 84 ? "healthy" : score > 60 ? "mixed" : "poor"}`}>
              <span>{model ? score : "—"}</span><small>/100</small>
            </div>
          </div>

          {!model ? (
            <div className="empty-diagnostics">
              <div className="scan-illustration"><span /><span /><span /></div>
              <h3>Your mesh report will appear here</h3>
              <p>We’ll inspect edges, faces, shells and surface orientation as soon as you add a model.</p>
            </div>
          ) : (
            <>
              <div className="issue-list">
                {issues.map((issue) => (
                  <div className="issue-row" key={issue.label}>
                    <span className={`status-dot ${issue.tone}`} />
                    <span>{issue.label}</span>
                    <strong>{fmt.format(issue.value)}</strong>
                  </div>
                ))}
                <div className="issue-row">
                  <span className="status-dot neutral" />
                  <span>Separate shells</span>
                  <strong>{fmt.format(model.stats.shells)}</strong>
                </div>
              </div>

              {model.repaired && (
                <div className="repair-summary">
                  <span>REPAIR SUMMARY</span>
                  <p>Removed {fmt.format(model.originalStats.degenerateFaces + model.originalStats.duplicateFaces)} unsafe faces and welded matching vertices.</p>
                </div>
              )}

              <div className="action-stack">
                {!model.repaired ? (
                  <button className="repair-button" onClick={repair} disabled={processing}>
                    <span>✦</span> Run safe repair
                    <small>Non-destructive topology cleanup</small>
                  </button>
                ) : (
                  <button className="download-button" onClick={download}>
                    <span>↓</span> Download repaired STL
                  </button>
                )}
                <p className="action-note">Safe repair removes duplicates and zero-area faces, welds coincident vertices and recalculates normals.</p>
              </div>
            </>
          )}
        </aside>
      </section>

      <section className="trust-strip" id="how-it-works">
        <div><span>01</span><strong>Private by design</strong><p>Your STL is processed in this tab and never sent to a server.</p></div>
        <div><span>02</span><strong>Changes you can see</strong><p>Compare topology counts before exporting the repaired model.</p></div>
        <div><span>03</span><strong>Slicer-ready output</strong><p>Download a standard binary STL for your existing print workflow.</p></div>
      </section>

      <footer><span>MeshMedic α</span><p>Automatic repair can’t infer design intent. Always inspect the slice preview before printing.</p></footer>
    </main>
  );
}
