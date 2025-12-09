import * as d3 from 'd3-force';
import { Box } from '@mui/material';
import customBreakpoints from '../../theme/base/breakpoints.ts';
import { useEffect, useRef, useState } from 'react';
 
type Node = {
  id: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  radius?: number;
  color?: string;
  fx?: number | null;
  fy?: number | null;
};

const NODE_RADIUS = 4;
const LINK_DISTANCE = 100; // px threshold for drawing an edge
const INITIAL_WIDTH = 900;
const INITIAL_HEIGHT = 600;

// Separate mouse effect radii for nodes and edges
const MOUSE_EFFECT_RADIUS_NODES = 700; // nodes remain visible farther
const MOUSE_EFFECT_RADIUS_EDGES = 375; // edges disappear sooner than nodes

// Choose falloff: "linear" or "quadratic"
const MOUSE_FALLOFF: "linear" | "quadratic" = "linear";

/** Smoothing for touch dragging (0 = immediate, 1 = no movement) */
const DRAG_LERP = 0.18;

/** Utility: convert #rrggbb to {r,g,b} */
function hexToRgb(hex: string) {
  if (!hex) return { r: 200, g: 200, b: 200 };
  const h = hex.replace("#", "");
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return { r, g, b };
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { r, g, b };
}

/**
 * CanvasForceGraph (responsive) with:
 * - global pointer tracking so the mouse node follows even when pointer is over other DOM elements
 * - separate proximity radii for nodes and edges (edges disappear before nodes)
 * - improved mobile dragging using pointer capture, touch-action none, rAF batching and smoothing (lerp)
 */
export default function CanvasForceGraph() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simulationRef = useRef<d3.Simulation<Node, undefined> | null>(null);

  // responsive size state (initial fallback)
  const [size, setSize] = useState({ width: INITIAL_WIDTH, height: INITIAL_HEIGHT });

  const SPEED_FACTOR = 0.44; // 1.0 = original speed

  // color weights
  const COLOR_WEIGHTS: { color: string; weight: number }[] = [
    { color: "#3cd962", weight: 0.75 }, // 75%
    { color: "#FF00FF", weight: 0.18 }, // 18%
    { color: "#e9fbfd", weight: 0.07 }, // 7%
  ];

  // radius factor bounds (10% - 20% of NODE_RADIUS)
  const RADIUS_MIN_FACTOR = 0.10;
  const RADIUS_MAX_FACTOR = 0.2;

  // Determine node count based on width using your custom breakpoints
  function getNodeCountForWidth(width: number) {
    const { sm, lg } = customBreakpoints;
    if (width < sm) return 75;        // mobile
    if (width < lg) return 150;       // tablet (sm <= width < lg)
    return 300;                       // desktop and larger (>= lg)
  }

  // helper: pick a color according to weights
  function pickWeightedColor(): string {
    const r = Math.random();
    let acc = 0;
    for (const cw of COLOR_WEIGHTS) {
      acc += cw.weight;
      if (r <= acc) return cw.color;
    }
    return COLOR_WEIGHTS[0].color;
  }

  // generate nodes with random positions inside current bounds
  function generateNodes(count: number, width: number, height: number): Node[] {
    return Array.from({ length: count }, (_, i) => {
      const factor = RADIUS_MIN_FACTOR + Math.random() * (RADIUS_MAX_FACTOR - RADIUS_MIN_FACTOR);
      const radius = Math.max(1, NODE_RADIUS * factor);

      return {
        id: i,
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 2 * SPEED_FACTOR,
        vy: (Math.random() - 0.5) * 2 * SPEED_FACTOR,
        radius,
        color: pickWeightedColor(),
        fx: null,
        fy: null,
      };
    });
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // initialize size from container
    const rect = container.getBoundingClientRect();
    setSize({
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height)),
    });

    // observe size changes
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({
          width: Math.max(1, Math.floor(cr.width)),
          height: Math.max(1, Math.floor(cr.height)),
        });
      }
    });
    ro.observe(container);

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    if (!canvas) return;

    const { width, height } = size;

    // compute node count for current width
    const NODE_COUNT = getNodeCountForWidth(width);
    console.log(`CanvasForceGraph — size: ${width}x${height}, NODE_COUNT: ${NODE_COUNT}`);

    // Hi-DPI scaling
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // ensure touch interactions don't trigger page scroll while interacting
    canvas.style.touchAction = "none";

    // generate nodes inside current bounds
    const nodes = generateNodes(NODE_COUNT, width, height);

    // create a dedicated mouse node (id = -1)
    const mouseRadius = Math.max(1, NODE_RADIUS * 0.15); // fixed, small size
    const mouseNode: Node = {
      id: -1,
      x: width / 2,
      y: height / 2,
      vx: 0,
      vy: 0,
      radius: mouseRadius,
      color: "#3cd962", // requested color
      fx: null,
      fy: null,
    };

    // append mouse node to nodes array so it participates in edges
    nodes.push(mouseNode);

    // stop previous simulation if any
    if (simulationRef.current) {
      simulationRef.current.stop();
      simulationRef.current = null;
    }

    // Create simulation
    const simulation = d3.forceSimulation(nodes)
      .force("charge", d3.forceManyBody().strength(0))
      .alpha(1)
      .alphaDecay(0)
      .velocityDecay(0)
      .on("tick", ticked);

    simulationRef.current = simulation;

    // Pointer handling state
    let rafId: number | null = null;
    let lastEvent: PointerEvent | null = null;
    let isDragging = false;
    let activePointerId: number | null = null;

    // Helper: linear interpolation
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    // Global pointer move (hover-like behavior) — still useful when not actively dragging
    function handlePointerMoveGlobal(e: PointerEvent) {
      // store last event and schedule rAF processing
      lastEvent = e;
      if (rafId == null) {
        rafId = requestAnimationFrame(processPointer);
      }
    }

    // Process pointer events in rAF loop
    function processPointer() {
      rafId = null;
      if (!lastEvent) return;
      const rect = canvas.getBoundingClientRect();
      let cx = lastEvent.clientX - rect.left;
      let cy = lastEvent.clientY - rect.top;
      // clamp to canvas bounds
      cx = Math.max(0, Math.min(cx, rect.width));
      cy = Math.max(0, Math.min(cy, rect.height));

      if (isDragging) {
        // Smooth the drag motion for touch by lerping toward the pointer
        mouseNode.x = lerp(mouseNode.x ?? cx, cx, DRAG_LERP);
        mouseNode.y = lerp(mouseNode.y ?? cy, cy, DRAG_LERP);
        mouseNode.fx = mouseNode.x;
        mouseNode.fy = mouseNode.y;
      } else {
        // Hover behavior: immediate follow (keeps node pinned to pointer)
        mouseNode.x = cx;
        mouseNode.y = cy;
        mouseNode.fx = cx;
        mouseNode.fy = cy;
      }

      // nudge simulation so it reacts immediately
      simulation.alpha(0.1);
      lastEvent = null;
    }

    // Start drag on pointerdown (capture pointer)
    function onPointerDown(e: PointerEvent) {
      // only primary pointer
      if (!e.isPrimary) return;
      // prevent default to avoid touch scrolling (listener must be non-passive)
      e.preventDefault();

      isDragging = true;
      activePointerId = e.pointerId;
      lastEvent = e;
      // capture pointer so we keep receiving events even if finger leaves canvas
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        // ignore if not supported
      }

      // ensure rAF loop runs
      if (rafId == null) rafId = requestAnimationFrame(processPointer);

      // make simulation responsive while dragging
      simulation.alphaTarget(0.1);
      simulation.restart();
    }

    // End drag on pointerup / pointercancel
    function endDragFromEvent(e: PointerEvent) {
      if (!e.isPrimary) return;
      if (activePointerId !== e.pointerId) {
        // if pointer IDs don't match, still end drag for safety
      }
      isDragging = false;
      activePointerId = null;
      lastEvent = null;
      // release pointer capture
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      // allow simulation to settle
      simulation.alphaTarget(0);
    }

    // pointerup handler
    function onPointerUp(e: PointerEvent) {
      endDragFromEvent(e);
    }

    // pointercancel handler
    function onPointerCancel(e: PointerEvent) {
      endDragFromEvent(e);
    }

    // pointerleave of window: unpin so nodes can drift
    function handlePointerLeaveGlobal() {
      if (!isDragging) {
        mouseNode.fx = null;
        mouseNode.fy = null;
      }
    }

    // Attach listeners
    // pointerdown must be non-passive so we can call preventDefault to stop scrolling
    canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    canvas.addEventListener("pointermove", handlePointerMoveGlobal);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("pointermove", handlePointerMoveGlobal);
    window.addEventListener("pointerleave", handlePointerLeaveGlobal);

    // Tick handler: update canvas each tick and handle bouncing using current width/height
    function ticked() {
      for (const n of nodes) {
        // if mouse node is pinned, keep its velocity zero and skip bounce adjustments
        if (n.id === -1 && n.fx != null && n.fy != null) {
          n.vx = 0;
          n.vy = 0;
          // ensure x/y match pinned position
          n.x = n.fx;
          n.y = n.fy;
          continue;
        }

        // clamp and reflect X
        if (n.x! <= n.radius!) {
          n.x = n.radius!;
          n.vx = Math.abs(n.vx ?? 0);
        } else if (n.x! >= width - n.radius!) {
          n.x = width - n.radius!;
          n.vx = -(Math.abs(n.vx ?? 0));
        }

        // clamp and reflect Y
        if (n.y! <= n.radius!) {
          n.y = n.radius!;
          n.vy = Math.abs(n.vy ?? 0);
        } else if (n.y! >= height - n.radius!) {
          n.y = height - n.radius!;
          n.vy = -(Math.abs(n.vy ?? 0));
        }
      }

      drawFrameWithSeparateRadii(ctx, nodes, width, height, mouseNode);
    }

    // initial draw
    drawFrameWithSeparateRadii(ctx, nodes, width, height, mouseNode);

    // cleanup on unmount or size change
    return () => {
      simulation.stop();
      simulationRef.current = null;

      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", handlePointerMoveGlobal);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("pointermove", handlePointerMoveGlobal);
      window.removeEventListener("pointerleave", handlePointerLeaveGlobal);

      // release any pointer capture if still active
      try {
        if (activePointerId != null) {
          (canvas as Element).releasePointerCapture(activePointerId);
        }
      } catch {}

      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  }, [size.width, size.height]); // re-run when container size changes

  return (
    <Box
      ref={containerRef}
      sx={{
        backgroundColor: "#0a1a1f",
        width: "100vw",
        height: "100vh",
        position: "relative"
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          touchAction: "none", // extra safety for some browsers
        }}
      />
    </Box>
  );
}

/**
 * drawFrameWithSeparateRadii
 * - draws edges and nodes
 * - uses MOUSE_EFFECT_RADIUS_EDGES and MOUSE_EFFECT_RADIUS_NODES separately
 * - edges disappear before nodes (edges use smaller radius)
 */
function drawFrameWithSeparateRadii(
  ctx: CanvasRenderingContext2D,
  nodes: Node[],
  width: number,
  height: number,
  mouseNode: Node
) {
  ctx.clearRect(0, 0, width, height);

  // squared radii for faster checks
  const rNodes = MOUSE_EFFECT_RADIUS_NODES;
  const rNodes2 = rNodes * rNodes;
  const rEdges = MOUSE_EFFECT_RADIUS_EDGES;
  const rEdges2 = rEdges * rEdges;

  // compute edges (naive O(n^2) — fine for moderate node counts)
  const edges: { a: Node; b: Node; dist: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = a.x! - b.x!;
      const dy = a.y! - b.y!;
      const dist = Math.hypot(dx, dy);
      if (dist <= LINK_DISTANCE) {
        edges.push({ a, b, dist });
      }
    }
  }

  // Helper: compute proximity factor (0..1) from a node to mouseNode using a given radius squared
  function proximityFactorToMouseWithRadius(n: Node, radius: number, radius2: number) {
    const dx = (n.x ?? 0) - (mouseNode.x ?? 0);
    const dy = (n.y ?? 0) - (mouseNode.y ?? 0);
    const d2 = dx * dx + dy * dy;
    if (d2 >= radius2) return 0; // outside effect radius -> fully invisible for that category
    const t = Math.sqrt(d2) / radius; // 0..1
    if (MOUSE_FALLOFF === "linear") {
      return Math.max(0, 1 - t);
    } else {
      // quadratic falloff (smoother)
      return Math.max(0, 1 - t * t);
    }
  }

  // draw edges (edges use rEdges)
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  for (const e of edges) {
    // base opacity from edge distance
    const baseOpacity = Math.max(0, 1 - e.dist / LINK_DISTANCE);

    // proximity influence for edges: average of the two node proximity factors using edge radius
    const paEdge = proximityFactorToMouseWithRadius(e.a, rEdges, rEdges2);
    const pbEdge = proximityFactorToMouseWithRadius(e.b, rEdges, rEdges2);

    // If both nodes are outside the edge effect radius, skip the edge entirely
    if (paEdge === 0 && pbEdge === 0) continue;

    const proximityEdge = (paEdge + pbEdge) / 2;

    // combine: edges near mouse get brighter; far edges (outside edge radius) are invisible
    const combinedOpacity = baseOpacity * proximityEdge;

    if (combinedOpacity <= 0.005) continue; // skip drawing extremely faint edges

    // use the chosen edge color (#4cc9e5 -> rgb(76,201,229))
    ctx.strokeStyle = `rgba(76,201,229,${combinedOpacity.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(e.a.x!, e.a.y!);
    ctx.lineTo(e.b.x!, e.b.y!);
    ctx.stroke();
  }

  // draw nodes (nodes use rNodes)
  for (const n of nodes) {
    // compute proximity factor for this node using node radius
    const pNode = proximityFactorToMouseWithRadius(n, rNodes, rNodes2); // 0..1

    // If node is outside the node effect radius, skip drawing (opacity 0)
    if (pNode === 0) continue;

    // map proximity to alpha directly (closer => alpha closer to 1)
    const alpha = pNode;
    if (alpha <= 0.01) continue;

    // convert node color to rgb and apply alpha
    const { r: cr, g: cg, b: cb } = hexToRgb(n.color ?? "#9fb4c8");
    ctx.beginPath();
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;

    // Optionally scale radius slightly by proximity for a subtle "pulse"
    const drawRadius = n.radius! * (1 + 0.35 * pNode);
    ctx.arc(n.x!, n.y!, drawRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}
