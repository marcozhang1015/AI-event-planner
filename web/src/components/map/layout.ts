// 示意地图的排版：等距圆柱投影、并排错开的路线、不出界且不互相压住的标签、比例尺。
// 纯函数，单位是 CSS 像素（地图按容器的真实尺寸排版）；字号、标记和线宽按页面根字号算，手机和投影上一样清楚。

import type { Size } from "./useSize";
import type { MapModel, MapPlace, PlaceKind } from "./model";

export interface Point {
  x: number;
  y: number;
}

export type Marker = MapPlace & Point;

export interface LabelLine {
  kind: "name" | "people";
  text: string;
  size: number;
  /** 基线位置。 */
  y: number;
}

export interface Label {
  id: string;
  x: number;
  anchor: "start" | "middle" | "end";
  lines: LabelLine[];
  /** 名字放不下被截断时的全名。 */
  full?: string;
}

export interface RouteLine {
  label: string;
  style: number;
  points: Point[];
}

export interface MapLayout {
  markers: Marker[];
  routes: RouteLine[];
  labels: Label[];
  /** 左下角的比例尺：(x, y) 是横线的左端。 */
  scale: Point & { length: number; text: string; size: number };
  radius: number;
  stroke: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LabelText {
  name: string;
  people?: string;
  w: number;
  h: number;
}

interface Spot {
  anchor: Label["anchor"];
  box: Box;
  overlap: number;
  moved: number;
}

const MIN_SPAN = 0.006; // 度：只有一个点或点挨得很近时，至少显示约 600 米的范围
const SERIF_EM = 0.42; // Instrument Serif 实测平均字宽 0.36–0.41em，估宽一点更保险
const MONO_EM = 0.7; // Martian Mono 是等宽字，每个字 0.7em
const METERS_PER_DEGREE = 111_320;
const MILE = 1609.344;
const SCALE_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50];
const EDGE = 6;

/** rem：页面根字号（手机 16px，投影上约 19px）。 */
export function layoutMap(model: MapModel, size: Size, rem: number): MapLayout {
  const radius = rem * 0.45;
  const stroke = rem * 0.25;
  const fonts = { name: rem * 0.9, people: rem * 0.56 };
  const pad = { x: clamp(size.width * 0.1, 28, 96), y: clamp(size.height * 0.12, 36, 88) };
  const { project, pxPerDegree } = fit(model.places, size, pad);

  const markers: Marker[] = model.places.map((place) => ({ ...place, ...project(place) }));
  const byId = new Map(markers.map((marker) => [marker.id, marker]));
  // 几辆车走同一段路时并排画：第 i 条线往左右错开
  const gap = stroke + 3;
  const routes = model.routes.map((route, index) => ({
    label: route.label,
    style: route.style,
    points: offsetLine(
      route.stops.flatMap((id) => byId.get(id) ?? []),
      (index - (model.routes.length - 1) / 2) * gap,
    ),
  }));

  const bar = scaleBar(pxPerDegree, size.width);
  const scale = { ...bar, x: 16, y: size.height - 16, size: fonts.people };
  const scaleBox = { x: scale.x - 4, y: scale.y - scale.size - 12, w: Math.max(bar.length, bar.text.length * scale.size * MONO_EM) + 8, h: scale.size + 16 };
  const labels = placeLabels(markers, size, radius, fonts, [scaleBox]);
  return { markers, routes, labels, scale, radius, stroke };
}

function fit(places: MapPlace[], size: Size, pad: Point) {
  const lats = places.map((place) => place.lat);
  const k = Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180);
  const xs = places.map((place) => place.lng * k);
  const ys = places.map((place) => -place.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // 横竖比例一致：按更紧的那个方向缩放，再居中
  const pxPerDegree = Math.min(
    Math.max(size.width - 2 * pad.x, 1) / Math.max(x1 - x0, MIN_SPAN),
    Math.max(size.height - 2 * pad.y, 1) / Math.max(y1 - y0, MIN_SPAN),
  );
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return {
    pxPerDegree,
    project: (place: MapPlace): Point => ({
      x: size.width / 2 + (place.lng * k - cx) * pxPerDegree,
      y: size.height / 2 + (-place.lat - cy) * pxPerDegree,
    }),
  };
}

/** 折线整体往行进方向的左边平移 d 像素，拐角按斜接算。 */
function offsetLine(line: Point[], d: number): Point[] {
  const points: Point[] = [];
  for (const point of line) {
    // 连着两站在同一个地方（比如司机出发的地方正好接人）只算一个点
    const last = points.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 0.5) points.push(point);
  }
  if (d === 0 || points.length < 2) return points;
  const normals = points.slice(1).map((b, index) => leftNormal(points[index] ?? b, b));
  return points.map((point, index) => {
    const normal = joinNormal(normals[index - 1], normals[index]);
    return { x: point.x + normal.x * d, y: point.y + normal.y * d };
  });
}

function leftNormal(a: Point, b: Point): Point {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
}

/** 拐角处的偏移方向：两段法线的角平分线，按斜接放长（最多两倍，急转弯不会戳出去太远）。 */
function joinNormal(before: Point | undefined, after: Point | undefined): Point {
  if (!before || !after) return before ?? after ?? { x: 0, y: 0 };
  const sum = { x: before.x + after.x, y: before.y + after.y };
  const length = Math.hypot(sum.x, sum.y);
  if (length < 1e-6) return before; // 原路折返
  const unit = { x: sum.x / length, y: sum.y / length };
  const stretch = 1 / Math.max(unit.x * before.x + unit.y * before.y, 0.5);
  return { x: unit.x * stretch, y: unit.y * stretch };
}

/**
 * 先放场地，再放集合点。每个标签试八个位置，取压住别的东西最少的那个。
 * 集合点先试"名字 + 在这上车的人"，放不下就只写名字；还是放不下就不写（车组列表里有），场地的名字总要写。
 */
function placeLabels(markers: Marker[], size: Size, radius: number, fonts: { name: number; people: number }, reserved: Box[]): Label[] {
  const bounds: Box = { x: EDGE, y: EDGE, w: size.width - 2 * EDGE, h: size.height - 2 * EDGE };
  const taken: Box[] = [...reserved, ...markers.map((marker) => ({ x: marker.x - radius - 3, y: marker.y - radius - 3, w: 2 * radius + 6, h: 2 * radius + 6 }))];
  const rank = (kind: PlaceKind) => (kind === "pickup" ? 1 : 0);
  const labels: Label[] = [];

  for (const marker of [...markers].sort((a, b) => rank(a.kind) - rank(b.kind))) {
    const tries = (marker.people.length ? [true, false] : [false]).map((withPeople) => {
      const text = labelText(marker, withPeople, bounds.w, fonts);
      return { text, spot: bestSpot(marker, text, radius, bounds, taken) };
    });
    const clean = tries.find(({ text, spot }) => spot.overlap <= text.w * text.h * 0.04);
    const chosen = clean ?? (marker.kind === "pickup" ? undefined : tries.at(-1));
    if (!chosen) continue;
    taken.push(chosen.spot.box);
    labels.push(toLabel(marker, chosen.text, chosen.spot, fonts));
  }
  return labels;
}

function labelText(marker: Marker, withPeople: boolean, maxWidth: number, fonts: { name: number; people: number }): LabelText {
  const name = truncate(marker.name, Math.floor(maxWidth / (fonts.name * SERIF_EM)));
  const people = withPeople ? truncate(marker.people.join(" · ").toUpperCase(), Math.floor(maxWidth / (fonts.people * MONO_EM))) : undefined;
  return {
    name,
    people,
    w: Math.max(name.length * fonts.name * SERIF_EM, people ? people.length * fonts.people * MONO_EM : 0),
    h: fonts.name * 1.15 + (people ? fonts.people * 1.5 : 0),
  };
}

/** 候选位置（右、左、上、下，再是四个斜角）里压住东西最少的；一样少就挑不用挪进画面的。 */
function bestSpot(marker: Marker, { w, h }: LabelText, radius: number, bounds: Box, taken: Box[]): Spot {
  const gap = radius + 6;
  const corner = gap * 0.7;
  const candidates: { anchor: Label["anchor"]; box: Box }[] = [
    { anchor: "start", box: { x: marker.x + gap, y: marker.y - h / 2, w, h } },
    { anchor: "end", box: { x: marker.x - gap - w, y: marker.y - h / 2, w, h } },
    { anchor: "middle", box: { x: marker.x - w / 2, y: marker.y - gap - h, w, h } },
    { anchor: "middle", box: { x: marker.x - w / 2, y: marker.y + gap, w, h } },
    { anchor: "start", box: { x: marker.x + corner, y: marker.y - corner - h, w, h } },
    { anchor: "end", box: { x: marker.x - corner - w, y: marker.y - corner - h, w, h } },
    { anchor: "start", box: { x: marker.x + corner, y: marker.y + corner, w, h } },
    { anchor: "end", box: { x: marker.x - corner - w, y: marker.y + corner, w, h } },
  ];
  return candidates
    .map(({ anchor, box: wanted }): Spot => {
      const box = clampBox(wanted, bounds);
      return {
        anchor,
        box,
        overlap: taken.reduce((sum, other) => sum + overlap(box, other), 0),
        moved: Math.abs(box.x - wanted.x) + Math.abs(box.y - wanted.y),
      };
    })
    .reduce((best, spot) => (spot.overlap < best.overlap || (spot.overlap === best.overlap && spot.moved < best.moved) ? spot : best));
}

function toLabel(marker: Marker, text: LabelText, { anchor, box }: Spot, fonts: { name: number; people: number }): Label {
  const x = anchor === "start" ? box.x : anchor === "end" ? box.x + box.w : box.x + box.w / 2;
  const lines: LabelLine[] = [{ kind: "name", text: text.name, size: fonts.name, y: box.y + fonts.name * 0.85 }];
  if (text.people) lines.push({ kind: "people", text: text.people, size: fonts.people, y: box.y + fonts.name * 1.15 + fonts.people * 1.15 });
  return { id: marker.id, x, anchor, lines, full: text.name === marker.name ? undefined : marker.name };
}

/** 取不超过画面宽度 22% 的最大一档（英里）。 */
function scaleBar(pxPerDegree: number, width: number) {
  const pxPerMile = (MILE / METERS_PER_DEGREE) * pxPerDegree;
  const miles = SCALE_STEPS.findLast((step) => step * pxPerMile <= width * 0.22) ?? 0.1;
  return { length: miles * pxPerMile, text: `${miles} mi` };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(max - 1, 1)).trimEnd()}…`;
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function clampBox(box: Box, bounds: Box): Box {
  return {
    ...box,
    x: clamp(box.x, bounds.x, bounds.x + bounds.w - box.w),
    y: clamp(box.y, bounds.y, bounds.y + bounds.h - box.h),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
