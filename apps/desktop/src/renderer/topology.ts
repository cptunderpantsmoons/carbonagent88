/**
 * Agent Topology View — SVG graph of Supervisor → Sub-Agent delegation
 */

import { createEmptyState } from "./components.js";

interface TopologyNode {
  id: string;
  label: string;
  status: "idle" | "running" | "completed" | "failed";
  x: number;
  y: number;
}

interface TopologyEdge {
  from: string;
  to: string;
}

let nodes: TopologyNode[] = [
  { id: "supervisor", label: "Supervisor", status: "idle", x: 300, y: 50 },
];
let edges: TopologyEdge[] = [];

function hasActiveTopology(): boolean {
  return nodes.length > 1 || edges.length > 0;
}

export function renderTopology(container: HTMLElement): void {
  container.innerHTML = `
    <div class="topology-header">
      <h2>Agent Topology</h2>
      <div class="topology-legend">
        <span class="topology-dot status-dot status-dot-muted"></span> Idle
        <span class="topology-dot status-dot status-dot-warning"></span> Running
        <span class="topology-dot status-dot status-dot-success"></span> Completed
        <span class="topology-dot status-dot status-dot-danger"></span> Failed
      </div>
    </div>
    <div class="topology-controls">
      <button id="topology-zoom-in" title="Zoom In">+</button>
      <button id="topology-zoom-out" title="Zoom Out">-</button>
      <button id="topology-reset" title="Reset View">⟲</button>
    </div>
    <div id="topology-empty" class="topology-empty-state"></div>
    <svg id="topology-svg" class="topology-svg"></svg>
  `;

  const svg = container.querySelector("#topology-svg") as SVGSVGElement;

  // Zoom / Pan state
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let lastPanX = 0;
  let lastPanY = 0;

  function updateTransform() {
    const g = svg.querySelector("#topology-transform-group") as SVGGElement;
    if (g) {
      g.setAttribute("transform", `translate(${panX}, ${panY}) scale(${scale})`);
    }
  }

  function updateEmptyState() {
    const emptyEl = container.querySelector("#topology-empty") as HTMLElement;
    const svgEl = container.querySelector("#topology-svg") as HTMLElement;
    if (!hasActiveTopology()) {
      emptyEl.innerHTML = "";
      emptyEl.appendChild(createEmptyState("icon-topology", "No Active Topology", "Multi-agent delegation appears here when a complex task triggers sub-agents."));
      emptyEl.classList.remove('invisible');
      svgEl.classList.add('invisible');
    } else {
      emptyEl.classList.add('invisible');
      svgEl.classList.remove('invisible');
    }
  }

  function renderTopologyGraphWithTransform(svgEl: SVGSVGElement) {
    svgEl.innerHTML = "";
    const width = svgEl.clientWidth || 600;
    const height = svgEl.clientHeight || 400;
    svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // Create a transformation group for zoom/pan
    const transformGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    transformGroup.id = "topology-transform-group";
    transformGroup.setAttribute("transform", `translate(${panX}, ${panY}) scale(${scale})`);

    // Draw edges
    for (const edge of edges) {
      const from = nodes.find(n => n.id === edge.from);
      const to = nodes.find(n => n.id === edge.to);
      if (!from || !to) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(from.x));
      line.setAttribute("y1", String(from.y + 20));
      line.setAttribute("x2", String(to.x));
      line.setAttribute("y2", String(to.y - 20));
      line.setAttribute("stroke", "var(--text-muted)");
      line.setAttribute("stroke-width", "2");
      transformGroup.appendChild(line);
    }

    // Draw nodes
    for (const node of nodes) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("transform", `translate(${node.x}, ${node.y})`);

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("r", "20");
      circle.setAttribute("fill", node.status === "running" ? "var(--warning)" : node.status === "completed" ? "var(--success)" : node.status === "failed" ? "var(--danger)" : "var(--text-muted)");
      circle.setAttribute("stroke", "var(--text-primary)");
      circle.setAttribute("stroke-width", "2");
      g.appendChild(circle);

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dy", "35");
      text.setAttribute("fill", "var(--text-primary)");
      text.setAttribute("font-size", "12");
      // Truncate labels with ellipsis via max-width approximation
      text.textContent = node.label.length > 18 ? node.label.slice(0, 16) + "…" : node.label;
      g.appendChild(text);

      transformGroup.appendChild(g);
    }

    svgEl.appendChild(transformGroup);
  }

  updateEmptyState();
  renderTopologyGraphWithTransform(svg);

  // Zoom controls
  container.querySelector("#topology-zoom-in")!.addEventListener("click", () => {
    scale = Math.min(scale * 1.2, 4);
    updateTransform();
  });
  container.querySelector("#topology-zoom-out")!.addEventListener("click", () => {
    scale = Math.max(scale / 1.2, 0.25);
    updateTransform();
  });
  container.querySelector("#topology-reset")!.addEventListener("click", () => {
    scale = 1;
    panX = 0;
    panY = 0;
    updateTransform();
  });

  // Pan via mouse drag
  svg.addEventListener("mousedown", (e) => {
    isPanning = true;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    svg.classList.add('grabbing');
  });

  document.addEventListener("mousemove", (e) => {
    if (!isPanning) return;
    const dx = e.clientX - lastPanX;
    const dy = e.clientY - lastPanY;
    panX += dx;
    panY += dy;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    updateTransform();
  });

  document.addEventListener("mouseup", () => {
    if (!isPanning) return;
    isPanning = false;
    svg.classList.remove('grabbing');
    svg.classList.add('grab');
  });

  svg.classList.add('grab');

  // Listen for IPC updates
  if (!window.carbonAPI.onAgentTopology) {
    return;
  }

  window.carbonAPI.onAgentTopology((data: unknown) => {
    const typed = data as { nodes: TopologyNode[]; edges: TopologyEdge[] };
    nodes = typed.nodes;
    edges = typed.edges;
    updateEmptyState();
    renderTopologyGraphWithTransform(svg);
  });
}
