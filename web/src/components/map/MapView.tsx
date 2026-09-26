// 地图：服务端有静态地图就显示图片；没有或加载失败时画 SVG 示意图（不加载外部瓦片和脚本）。

import { useId, useMemo, useState } from "react";
import type { ItineraryView, MapPin, OptionView } from "@shared/views";
import { listOf } from "../../format";
import { useSize } from "./useSize";
import { layoutMap, type Label, type Marker, type RouteLine } from "./layout";
import { buildMapModel, type MapModel, type PlaceKind } from "./model";

interface MapViewProps {
  pins?: MapPin[];
  option?: OptionView;
  itinerary?: ItineraryView;
  imageUrl?: string;
}

const KINDS: PlaceKind[] = ["pickup", "activity", "restaurant"];
const KIND_LABEL: Record<PlaceKind, string> = { pickup: "Pickup spot", activity: "Activity", restaurant: "Restaurant" };

export function MapView({ pins, option, itinerary, imageUrl }: MapViewProps) {
  const model = useMemo(() => buildMapModel({ pins, option, itinerary }), [pins, option, itinerary]);
  const [brokenUrl, setBrokenUrl] = useState<string>();
  const showImage = imageUrl !== undefined && imageUrl !== brokenUrl;
  if (!showImage && model.places.length === 0) return null;
  const description = describe(model);
  return (
    <figure className="map">
      {showImage ? (
        <img className="map-image" src={imageUrl} alt={description} decoding="async" onError={() => setBrokenUrl(imageUrl)} />
      ) : (
        <>
          <Schematic model={model} description={description} />
          <Legend model={model} />
        </>
      )}
    </figure>
  );
}

function Schematic({ model, description }: { model: MapModel; description: string }) {
  const [ref, size] = useSize<HTMLDivElement>();
  // 根字号随视口变，视口一变容器尺寸也会变，所以跟着 size 重新排版就够了
  const layout = useMemo(() => (size ? layoutMap(model, size, rootFontSize()) : undefined), [model, size]);
  const dots = `map-dots${useId().replace(/[^\w-]/g, "")}`;
  return (
    <div ref={ref} className="map-canvas">
      {size && layout && (
        <svg viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={description}>
          <defs>
            <pattern id={dots} width="24" height="24" patternUnits="userSpaceOnUse">
              <circle className="map-dot" cx="12" cy="12" r="1.2" />
            </pattern>
          </defs>
          <rect width={size.width} height={size.height} fill={`url(#${dots})`} />
          {/* 先画所有路线的底色衬线，再画线：后画的车不会把先画的车的线盖住 */}
          {(["casing", "line"] as const).map((layer) => (
            <g key={layer}>
              {layout.routes.map((route) => (
                <RoutePath key={route.label} route={route} layer={layer} width={layout.stroke} />
              ))}
            </g>
          ))}
          {layout.markers.map((marker) => (
            <MarkerShape key={marker.id} marker={marker} radius={layout.radius} />
          ))}
          {layout.labels.map((label) => (
            <PlaceLabel key={label.id} label={label} />
          ))}
          <g className="map-scale" transform={`translate(${layout.scale.x} ${layout.scale.y})`}>
            <path d={`M0 -5V0H${layout.scale.length.toFixed(1)}V-5`} />
            <text y={-9} fontSize={layout.scale.size}>
              {layout.scale.text}
            </text>
          </g>
        </svg>
      )}
    </div>
  );
}

/** casing：线下面垫的一条底色宽线，几条线交叉时看得清。 */
function RoutePath({ route, layer, width }: { route: RouteLine; layer: "casing" | "line"; width: number }) {
  const points = route.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return (
    <polyline
      className={`map-route route-${route.style} map-route-${layer}`}
      points={points}
      strokeWidth={layer === "casing" ? width + 4 : width}
    />
  );
}

function MarkerShape({ marker, radius }: { marker: Marker; radius: number }) {
  return (
    <g className={`map-marker map-marker-${marker.kind}`} transform={`translate(${marker.x.toFixed(1)} ${marker.y.toFixed(1)})`}>
      <Glyph kind={marker.kind} radius={radius} />
    </g>
  );
}

/** 集合点是空心圆，活动是三角，餐厅是方块：和时间线上的标记一样。 */
function Glyph({ kind, radius: r }: { kind: PlaceKind; radius: number }) {
  if (kind === "pickup") return <circle r={r} />;
  if (kind === "activity") return <path d={`M0 ${-1.2 * r}L${1.1 * r} ${0.8 * r}H${-1.1 * r}Z`} />;
  return <rect x={-0.85 * r} y={-0.85 * r} width={1.7 * r} height={1.7 * r} rx={1.5} />;
}

function PlaceLabel({ label }: { label: Label }) {
  return (
    <text className="map-label" textAnchor={label.anchor}>
      {label.lines.map((line) => (
        <tspan key={line.kind} className={`map-label-${line.kind}`} x={label.x.toFixed(1)} y={line.y.toFixed(1)} fontSize={line.size}>
          {line.text}
        </tspan>
      ))}
      {label.full && <title>{label.full}</title>}
    </text>
  );
}

function Legend({ model }: { model: MapModel }) {
  const kinds = KINDS.filter((kind) => model.places.some((place) => place.kind === kind));
  return (
    <figcaption className="map-legend">
      <ul>
        {model.routes.map((route) => (
          <li key={route.label}>
            <RouteSwatch style={route.style} />
            {route.label}
          </li>
        ))}
        {kinds.map((kind) => (
          <li key={kind}>
            <svg className="glyph" viewBox="-8 -8 16 16" aria-hidden="true">
              <g className={`map-marker-${kind}`}>
                <Glyph kind={kind} radius={5} />
              </g>
            </svg>
            {KIND_LABEL[kind]}
          </li>
        ))}
      </ul>
    </figcaption>
  );
}

/** 一小段和地图上同样画法的线：车组列表里用它对应地图上的哪条路线。 */
export function RouteSwatch({ style }: { style: number }) {
  return (
    <svg className="swatch" viewBox="0 0 30 10" aria-hidden="true">
      <line className={`route-${style} map-route-line`} x1="4" y1="5" x2="26" y2="5" strokeWidth="4" />
    </svg>
  );
}

function rootFontSize(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

function describe(model: MapModel): string {
  if (!model.places.length) return "Map of the plan";
  const routes = model.routes.length ? ` Routes: ${listOf(model.routes.map((route) => route.label))}.` : "";
  return `Map of ${listOf(model.places.map((place) => place.name))}.${routes}`;
}
