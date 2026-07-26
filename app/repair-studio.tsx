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
  repairInfo?: {
    removedFaces: number;
    weldedVertices: number;
    holesFilled: number;
    facesAdded: number;
  };
};

type RepairOptions = {
  removeUnsafe: boolean;
  weldVertices: boolean;
  recalculateNormals: boolean;
  fillPlanarHoles: boolean;
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

function safeRepair(source: THREE.BufferGeometry, options: RepairOptions) {
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
    if (options.removeUnsafe && (area < 1e-14 || seen.has(key))) continue;
    seen.add(key);
    kept.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  const cleaned = new THREE.BufferGeometry();
  cleaned.setAttribute("position", new THREE.Float32BufferAttribute(kept, 3));
  const repaired = options.weldVertices ? mergeVertices(cleaned, 1e-5) : cleaned.clone();
  if (options.recalculateNormals) {
    repaired.deleteAttribute("normal");
    repaired.computeVertexNormals();
  }
  repaired.computeBoundingBox();
  repaired.computeBoundingSphere();
  nonIndexed.dispose();
  cleaned.dispose();
  return repaired;
}

type BoundaryEdge = { a: number; b: number };

function indexedGeometry(source: THREE.BufferGeometry) {
  return source.index ? source.clone() : mergeVertices(source.clone(), 1e-5);
}

function boundaryData(source: THREE.BufferGeometry) {
  const geometry = indexedGeometry(source);
  const index = geometry.getIndex();
  const edgeUses = new Map<string, BoundaryEdge[]>();
  if (!index) return { geometry, boundaries: [] as BoundaryEdge[], nonManifold: [] as BoundaryEdge[] };

  for (let i = 0; i < index.count; i += 3) {
    const face = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    for (const [a, b] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const uses = edgeUses.get(key) ?? [];
      uses.push({ a, b });
      edgeUses.set(key, uses);
    }
  }

  const boundaries: BoundaryEdge[] = [];
  const nonManifold: BoundaryEdge[] = [];
  edgeUses.forEach((uses) => {
    if (uses.length === 1) boundaries.push(uses[0]);
    if (uses.length > 2) nonManifold.push(uses[0]);
  });
  return { geometry, boundaries, nonManifold };
}

function boundaryLoops(source: THREE.BufferGeometry) {
  const { geometry, boundaries } = boundaryData(source);
  const outgoing = new Map<number, BoundaryEdge[]>();
  boundaries.forEach((edge) => {
    const list = outgoing.get(edge.a) ?? [];
    list.push(edge);
    outgoing.set(edge.a, list);
  });

  const used = new Set<string>();
  const loops: number[][] = [];
  const id = (edge: BoundaryEdge) => `${edge.a}>${edge.b}`;

  for (const start of boundaries) {
    if (used.has(id(start))) continue;
    const loop = [start.a];
    let edge = start;
    let guard = 0;
    while (guard++ < boundaries.length + 1) {
      used.add(id(edge));
      loop.push(edge.b);
      if (edge.b === start.a) {
        loop.pop();
        if (loop.length >= 3) loops.push(loop);
        break;
      }
      const next = (outgoing.get(edge.b) ?? []).find((candidate) => !used.has(id(candidate)));
      if (!next) break;
      edge = next;
    }
  }
  return { geometry, loops };
}

function fillConservativeHoles(source: THREE.BufferGeometry) {
  const { geometry, loops } = boundaryLoops(source);
  const position = geometry.getAttribute("position");
  const base = geometry.toNonIndexed();
  const basePosition = base.getAttribute("position");
  const values = Array.from(basePosition.array as ArrayLike<number>);
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox?.getSize(size);
  const diagonal = Math.max(size.length(), 1e-6);
  let holesFilled = 0;
  let facesAdded = 0;

  for (const loop of loops) {
    if (loop.length < 3 || loop.length > 128) continue;
    const points = loop.map((index) => new THREE.Vector3().fromBufferAttribute(position, index));
    const centroid = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
    const normal = new THREE.Vector3();
    for (let i = 0; i < points.length; i += 1) {
      const current = points[i];
      const next = points[(i + 1) % points.length];
      normal.x += (current.y - next.y) * (current.z + next.z);
      normal.y += (current.z - next.z) * (current.x + next.x);
      normal.z += (current.x - next.x) * (current.y + next.y);
    }
    if (normal.lengthSq() < 1e-12) continue;
    normal.normalize();
    const maxPlaneError = Math.max(...points.map((point) => Math.abs(point.clone().sub(centroid).dot(normal))));
    if (maxPlaneError > diagonal * 0.006) continue;

    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      values.push(b.x, b.y, b.z, a.x, a.y, a.z, centroid.x, centroid.y, centroid.z);
      facesAdded += 1;
    }
    holesFilled += 1;
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
  const welded = mergeVertices(result, 1e-5);
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  geometry.dispose();
  base.dispose();
  result.dispose();
  return { geometry: welded, holesFilled, facesAdded };
}

function faultSegments(source: THREE.BufferGeometry) {
  const { geometry, boundaries, nonManifold } = boundaryData(source);
  const position = geometry.getAttribute("position");
  const naked: number[] = [];
  const manifold: number[] = [];
  const append = (target: number[], edge: BoundaryEdge) => {
    const a = new THREE.Vector3().fromBufferAttribute(position, edge.a);
    const b = new THREE.Vector3().fromBufferAttribute(position, edge.b);
    target.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  boundaries.forEach((edge) => append(naked, edge));
  nonManifold.forEach((edge) => append(manifold, edge));
  geometry.dispose();
  return { naked, manifold };
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

function ModelViewport({
  model,
  wireframe,
  showFaults,
  viewMode,
  activeIssue,
}: {
  model: LoadedModel | null;
  wireframe: boolean;
  showFaults: boolean;
  viewMode: "original" | "repaired";
  activeIssue: "open" | "nonManifold" | null;
}) {
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
    const faultObjects: THREE.LineSegments[] = [];
    if (model) {
      const source = viewMode === "original" ? model.original : model.current;
      const faults = showFaults ? faultSegments(source) : null;
      const geometry = source.clone();
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
        transparent: Boolean(activeIssue),
        opacity: activeIssue ? 0.26 : 1,
      });
      mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      if (faults) {
        const sourceBox = new THREE.Box3().setFromBufferAttribute(source.getAttribute("position"));
        const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
        const makeFaults = (values: number[], color: string) => {
          if (!values.length) return;
          const faultGeometry = new THREE.BufferGeometry();
          faultGeometry.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
          faultGeometry.translate(-sourceCenter.x, -sourceCenter.y, -sourceCenter.z);
          faultGeometry.scale(2.7 / max, 2.7 / max, 2.7 / max);
          faultGeometry.rotateX(-Math.PI / 2);
          const lines = new THREE.LineSegments(
            faultGeometry,
            new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }),
          );
          lines.renderOrder = 4;
          faultObjects.push(lines);
          scene.add(lines);
        };
        if (!activeIssue || activeIssue === "open") makeFaults(faults.naked, "#ffbd4a");
        if (!activeIssue || activeIssue === "nonManifold") makeFaults(faults.manifold, "#ff5f6d");
      }
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
      faultObjects.forEach((lines) => {
        lines.geometry.dispose();
        (lines.material as THREE.Material).dispose();
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [model, wireframe, showFaults, viewMode, activeIssue]);

  return <div ref={mountRef} className="viewport-canvas" aria-label="Interactive 3D model preview" />;
}

export function RepairStudio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [showFaults, setShowFaults] = useState(true);
  const [viewMode, setViewMode] = useState<"original" | "repaired">("original");
  const [activeIssue, setActiveIssue] = useState<"open" | "nonManifold" | null>(null);
  const [repairOptions, setRepairOptions] = useState<RepairOptions>({
    removeUnsafe: true,
    weldVertices: true,
    recalculateNormals: true,
    fillPlanarHoles: true,
  });
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
      setViewMode("original");
      setActiveIssue(null);
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
    const cleaned = safeRepair(model.current, repairOptions);
    const filled = repairOptions.fillPlanarHoles
      ? fillConservativeHoles(cleaned)
      : { geometry: cleaned.clone(), holesFilled: 0, facesAdded: 0 };
    const stats = analyseGeometry(filled.geometry);
    setModel({
      ...model,
      current: filled.geometry,
      stats,
      repaired: true,
      repairInfo: {
        removedFaces: model.stats.degenerateFaces + model.stats.duplicateFaces,
        weldedVertices: Math.max(0, model.stats.vertices - stats.vertices + filled.facesAdded),
        holesFilled: filled.holesFilled,
        facesAdded: filled.facesAdded,
      },
    });
    cleaned.dispose();
    setViewMode("repaired");
    setActiveIssue(null);
    setStatus("Standard repair complete");
    setProcessing(false);
  };

  const reset = () => {
    if (!model) return;
    const original = model.original.clone();
    setModel({ ...model, current: original, stats: model.originalStats, repaired: false, repairInfo: undefined });
    setViewMode("original");
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
          <span className="brand-mark"><img src="/meshmedic-mark.png" alt="" /></span>
          <span>MeshMedic</span>
        </a>
        <div className="privacy-pill"><span /> Local processing · your file stays private</div>
        <div className="topbar-actions">
          <a className="text-link" href="#how-it-works">How it works</a>
          <a className="support-button" href="https://buymeacoffee.com/skylrskitchen" target="_blank" rel="noreferrer">☕ Support MeshMedic</a>
        </div>
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
              {model && <button className={showFaults ? "icon-button active" : "icon-button"} onClick={() => setShowFaults(!showFaults)} aria-label="Toggle fault highlighting">!</button>}
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
            <ModelViewport model={model} wireframe={wireframe} showFaults={showFaults} viewMode={viewMode} activeIssue={activeIssue} />
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
              <>
                {model.repaired && (
                  <div className="comparison-toggle" aria-label="Compare original and repaired model">
                    <button className={viewMode === "original" ? "active" : ""} onClick={() => setViewMode("original")}>Original</button>
                    <button className={viewMode === "repaired" ? "active" : ""} onClick={() => setViewMode("repaired")}>Repaired</button>
                  </div>
                )}
                {showFaults && (viewMode === "original" || !model.repaired) && (
                  <div className="fault-legend">
                    {(!activeIssue || activeIssue === "open") && <><span className="naked" /> Open edge</>}
                    {(!activeIssue || activeIssue === "nonManifold") && <><span className="manifold" /> Non-manifold</>}
                    {activeIssue && <button onClick={() => setActiveIssue(null)}>Show all</button>}
                  </div>
                )}
                <div className="model-meta">
                  <span>{formatBytes(model.bytes)}</span>
                  <span>{fmt.format((viewMode === "original" ? model.originalStats : model.stats).triangles)} triangles</span>
                  <span>Drag to orbit · scroll to zoom</span>
                </div>
              </>
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
                {issues.map((issue) => {
                  const issueKey = issue.label === "Open edges" ? "open" : issue.label === "Non-manifold" ? "nonManifold" : null;
                  return (
                  <button
                    className={`issue-row ${issueKey && activeIssue === issueKey ? "selected" : ""}`}
                    key={issue.label}
                    onClick={() => {
                      if (!issueKey || issue.value === 0) return;
                      setActiveIssue(activeIssue === issueKey ? null : issueKey);
                      setShowFaults(true);
                      setViewMode("original");
                    }}
                    disabled={!issueKey || issue.value === 0}
                  >
                    <span className={`status-dot ${issue.tone}`} />
                    <span>{issue.label}</span>
                    <strong>{fmt.format(issue.value)}</strong>
                    {issueKey && issue.value > 0 && <small>Inspect</small>}
                  </button>
                )})}
                <div className="issue-row">
                  <span className="status-dot neutral" />
                  <span>Separate shells</span>
                  <strong>{fmt.format(model.stats.shells)}</strong>
                </div>
              </div>

              {model.repaired && (
                <div className="repair-summary">
                  <span>REPAIR SUMMARY</span>
                  <div className="summary-grid">
                    <strong>{model.repairInfo?.holesFilled ?? 0}<small>holes filled</small></strong>
                    <strong>{model.repairInfo?.removedFaces ?? 0}<small>faces removed</small></strong>
                    <strong>{model.repairInfo?.facesAdded ?? 0}<small>faces added</small></strong>
                  </div>
                </div>
              )}

              <div className="action-stack">
                {!model.repaired ? (
                  <>
                    <div className="repair-controls">
                      <div><span>REPAIR OPERATIONS</span><small>Choose exactly what changes</small></div>
                      {([
                        ["removeUnsafe", "Remove unsafe faces"],
                        ["weldVertices", "Weld matching vertices"],
                        ["recalculateNormals", "Recalculate normals"],
                        ["fillPlanarHoles", "Fill planar holes"],
                      ] as [keyof RepairOptions, string][]).map(([key, label]) => (
                        <label key={key}>
                          <input
                            type="checkbox"
                            checked={repairOptions[key]}
                            onChange={() => setRepairOptions({ ...repairOptions, [key]: !repairOptions[key] })}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    <button className="repair-button" onClick={repair} disabled={processing || !Object.values(repairOptions).some(Boolean)}>
                      <span>✦</span> Apply selected repairs
                      <small>Review the result before export</small>
                    </button>
                  </>
                ) : (
                  <button className="download-button" onClick={download}>
                    <span>↓</span> Download repaired STL
                  </button>
                )}
                <p className="action-note">Standard repair cleans unsafe faces, welds matching vertices, recalculates normals and fills conservative planar boundaries. Complex openings are left untouched.</p>
              </div>
            </>
          )}
        </aside>
      </section>

      <a className="sponsor-banner" href="https://chichester3dprinting.com/" target="_blank" rel="sponsored noreferrer">
        <div className="sponsor-visual" aria-hidden="true">
          <div className="print-bed"><span /><span /><span /></div>
          <div className="printed-part">3D</div>
        </div>
        <div className="sponsor-copy">
          <span className="sponsor-label">Featured printing partner</span>
          <h2>File fixed. Now make it real.</h2>
          <p>Take your repaired model from screen to finished part with Chichester 3D Printing.</p>
        </div>
        <div className="sponsor-brand">
          <span>CHICHESTER</span>
          <strong>3D PRINTING</strong>
          <small>Visit the print studio ↗</small>
        </div>
      </a>

      <section className="trust-strip" id="how-it-works">
        <div><span>01</span><strong>Private by design</strong><p>Your STL is processed in this tab and never sent to a server.</p></div>
        <div><span>02</span><strong>Changes you can see</strong><p>Compare topology counts before exporting the repaired model.</p></div>
        <div><span>03</span><strong>Slicer-ready output</strong><p>Download a standard binary STL for your existing print workflow.</p></div>
      </section>

      <aside className="support-card">
        <div className="support-cup" aria-hidden="true">☕</div>
        <div>
          <span className="eyebrow">Community supported</span>
          <h2>MeshMedic is free to use.</h2>
          <p>If it rescued a model or saved you a failed print, you can help keep the tool improving with a small, entirely optional contribution.</p>
        </div>
        <a href="https://buymeacoffee.com/skylrskitchen" target="_blank" rel="noreferrer">
          Buy us a coffee <span>↗</span>
        </a>
      </aside>

      <section className="seo-content">
        <div className="seo-intro">
          <span className="eyebrow">Free online STL fixer</span>
          <h2>Make broken 3D models printable again.</h2>
          <p>An STL can look correct on screen while still containing gaps, doubled triangles, inside-out surfaces or impossible edges. MeshMedic examines the triangle topology behind the model, shows you where common faults live and lets you choose which safe repairs to apply.</p>
        </div>
        <div className="seo-features">
          <article>
            <span>01</span>
            <h3>Fix non-manifold STL geometry</h3>
            <p>Find edges connected to too many faces—the kind of ambiguous geometry that can cause missing layers, strange toolpaths and failed slices.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Close straightforward mesh holes</h3>
            <p>Detect exposed boundaries and conservatively fill small, near-planar openings while leaving complex or uncertain geometry untouched.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Repair without uploading</h3>
            <p>Your STL stays on your device. Analysis, visualisation and repair run locally in the browser, with no server queue or model storage.</p>
          </article>
        </div>
        <div className="faq-block" id="faq">
          <div>
            <span className="eyebrow">STL repair questions</span>
            <h2>Before you slice.</h2>
          </div>
          <div className="faq-list">
            <details>
              <summary>How do I repair an STL file online?<span>+</span></summary>
              <p>Drop the STL into MeshMedic, inspect the highlighted issues, select your repair operations and compare the original with the repaired model before downloading.</p>
            </details>
            <details>
              <summary>Does MeshMedic upload or store my model?<span>+</span></summary>
              <p>No. The file is parsed and repaired locally inside your web browser. It is not sent to a MeshMedic server.</p>
            </details>
            <details>
              <summary>What mesh errors can it detect?<span>+</span></summary>
              <p>MeshMedic checks for open edges, non-manifold edges, degenerate faces, duplicate faces and separate shells. It can also weld matching vertices and recalculate surface normals.</p>
            </details>
            <details>
              <summary>Will automatic repair always preserve my design?<span>+</span></summary>
              <p>No automatic tool can completely understand design intent. MeshMedic uses conservative operations and lets you review the result, but you should always inspect the final slice preview before printing.</p>
            </details>
          </div>
        </div>
      </section>

      <footer>
        <span>MeshMedic α · © {new Date().getFullYear()} <a href="https://greypatrick.com" target="_blank" rel="noreferrer">Grey Patrick</a></span>
        <p>Automatic repair can’t infer design intent. Always inspect the slice preview before printing.</p>
      </footer>
    </main>
  );
}
