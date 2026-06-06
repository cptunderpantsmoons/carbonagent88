/**
 * Watcher Analytics Dashboard — SVG charts for execution metrics
 */

import { createEmptyState } from "./components.js";

interface WatcherRun {
  watcherId: string;
  watcherName: string;
  startedAt: string;
  completedAt?: string;
  success: boolean;
}

let runs: WatcherRun[] = [];

function renderLineChart(svg: SVGSVGElement, data: number[], _labels: string[], color: string) {
  const width = svg.clientWidth || 400;
  const height = svg.clientHeight || 200;
  const padding = 30;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";

  if (data.length === 0) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(width / 2));
    text.setAttribute("y", String(height / 2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "var(--text-muted)");
    text.textContent = "No data";
    svg.appendChild(text);
    return;
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const xScale = (i: number) => padding + (i / (data.length - 1 || 1)) * (width - padding * 2);
  const yScale = (v: number) => height - padding - ((v - min) / range) * (height - padding * 2);

  // Grid lines
  for (let i = 0; i <= 4; i++) {
    const y = padding + (i / 4) * (height - padding * 2);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(padding));
    line.setAttribute("x2", String(width - padding));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "var(--bg-elevated)");
    line.setAttribute("stroke-dasharray", "2,2");
    svg.appendChild(line);
  }

  // Path
  let d = "";
  for (let i = 0; i < data.length; i++) {
    const x = xScale(i);
    const y = yScale(data[i]!);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", color);
  path.setAttribute("stroke-width", "2");
  svg.appendChild(path);

  // Points with tooltips
  for (let i = 0; i < data.length; i++) {
    const cx = xScale(i);
    const cy = yScale(data[i]!);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", "5");
    circle.setAttribute("fill", color);
    circle.classList.add('svg-cursor-pointer');
    svg.appendChild(circle);

    // Tooltip <title> element for native SVG hover
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${_labels[i] ?? `Point ${i + 1}`}: ${data[i]!.toFixed(0)} ms`;
    circle.appendChild(title);

    // Hover enlarge effect via JS
    circle.addEventListener("mouseenter", () => {
      circle.setAttribute("r", "7");
      circle.setAttribute("fill", "var(--text-primary)");
    });
    circle.addEventListener("mouseleave", () => {
      circle.setAttribute("r", "5");
      circle.setAttribute("fill", color);
    });
  }
}

function renderBarChart(svg: SVGSVGElement, labels: string[], values: number[], colors: string[]) {
  const width = svg.clientWidth || 400;
  const height = svg.clientHeight || 200;
  const padding = 30;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";

  if (values.length === 0) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(width / 2));
    text.setAttribute("y", String(height / 2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "var(--text-muted)");
    text.textContent = "No data";
    svg.appendChild(text);
    return;
  }

  const max = Math.max(...values, 1);
  const barWidth = (width - padding * 2) / values.length * 0.6;
  const gap = (width - padding * 2) / values.length * 0.4;

  for (let i = 0; i < values.length; i++) {
    const barHeight = (values[i]! / max) * (height - padding * 2);
    const x = padding + i * (barWidth + gap) + gap / 2;
    const y = height - padding - barHeight;

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.classList.add('svg-cursor-pointer');

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(barWidth));
    rect.setAttribute("height", String(barHeight));
    rect.setAttribute("fill", colors[i % colors.length]!);
    g.appendChild(rect);

    // Tooltip <title> element
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${labels[i] ?? "Category"}: ${values[i]}`;
    g.appendChild(title);

    // Hover effect
    g.addEventListener("mouseenter", () => {
      rect.setAttribute("fill", "var(--text-primary)");
    });
    g.addEventListener("mouseleave", () => {
      rect.setAttribute("fill", colors[i % colors.length]!);
    });

    svg.appendChild(g);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(x + barWidth / 2));
    label.setAttribute("y", String(height - padding + 15));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("fill", "var(--text-muted)");
    label.setAttribute("font-size", "10");
    label.textContent = labels[i] ?? "";
    svg.appendChild(label);
  }
}

export function renderWatcherAnalytics(container: HTMLElement): void {
  container.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "view-stack analytics-shell";

  const hero = document.createElement("section");
  hero.className = "view-hero";
  hero.innerHTML = `
    <div class="view-hero-kicker">Watcher Analytics</div>
    <div class="view-hero-title">Execution metrics for background watchers.</div>
    <div class="view-hero-copy">Charts update in real time when watcher runs complete. Execution times and success/fail ratios are tracked per watcher.</div>
  `;
  const heroMeta = document.createElement("div");
  heroMeta.className = "view-hero-meta";
  heroMeta.innerHTML = `<span>Execution time</span><span>Success ratio</span><span>SVG charts</span><span>Live data</span>`;
  hero.appendChild(heroMeta);
  shell.appendChild(hero);

  const empty = document.createElement("div");
  empty.id = "analytics-empty";
  empty.className = "analytics-empty";

  const grid = document.createElement("div");
  grid.className = "analytics-grid";
  grid.id = "analytics-grid";

  const timeCard = document.createElement("div");
  timeCard.className = "analytics-card";
  timeCard.innerHTML = `<div class="analytics-title">Execution Time (ms)</div>`;
  const timeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  timeSvg.id = "analytics-time-chart";
  timeSvg.classList.add("analytics-chart");
  timeCard.appendChild(timeSvg);

  const ratioCard = document.createElement("div");
  ratioCard.className = "analytics-card";
  ratioCard.innerHTML = `<div class="analytics-title">Success / Fail Ratio</div>`;
  const ratioSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ratioSvg.id = "analytics-ratio-chart";
  ratioSvg.classList.add("analytics-chart");
  ratioCard.appendChild(ratioSvg);

  grid.append(timeCard, ratioCard);
  shell.append(hero, empty, grid);
  container.appendChild(shell);

  function refresh() {
    if (runs.length === 0) {
      empty.innerHTML = "";
      empty.appendChild(createEmptyState("icon-analytics", "No Watcher Data", "Create a watcher to start tracking background task analytics."));
      empty.classList.remove('invisible');
      grid.classList.add('invisible');
      return;
    }
    empty.classList.add('invisible');
    grid.classList.remove('invisible');

    // Execution times
    const times = runs.filter(r => r.completedAt).map(r => {
      const start = new Date(r.startedAt).getTime();
      const end = new Date(r.completedAt!).getTime();
      return end - start;
    });
    const timeLabels = times.map((_, i) => `Run ${i + 1}`);
    renderLineChart(timeSvg, times, timeLabels, "var(--info)");

    // Success/fail ratio
    const successCount = runs.filter(r => r.success).length;
    const failCount = runs.length - successCount;
    renderBarChart(ratioSvg, ["Success", "Fail"], [successCount, failCount], ["var(--success)", "var(--danger)"]);
  }

  if (window.carbonAPI.onWatcherAnalytics) {
    window.carbonAPI.onWatcherAnalytics((data: unknown) => {
      const typed = data as { runs: WatcherRun[] };
      runs = typed.runs;
      refresh();
    });
  }

  refresh();
}
