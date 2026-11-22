import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L, { type LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Point } from '../domain/geo';

export interface StreetPoint {
  id: string;
  lat: number;
  lon: number;
  label: string;
  name: string;
  warn?: boolean;
  muted?: boolean;
  /** Small dot instead of a numbered pin (ranked places not currently shown in the list). Dots stay at their true location. */
  dot?: boolean;
}

/**
 * Street map (towns, villages, roads) from the standard OpenStreetMap tile server (free with attribution; fine for
 * datathon-scale traffic, not for heavy production use: https://operations.osmfoundation.org/policies/tiles/).
 * Privacy trade-off, stated in the UI: loading tiles tells the tile server which map area is being viewed.
 * Borders in these tiles are OpenStreetMap's de facto lines, not the Survey of India's.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
/** Keep the map on India: panning stops at these edges (with a little margin) and you cannot zoom out to the world. */
const INDIA_BOUNDS: LatLngBoundsExpression = [[5.0, 66.0], [38.5, 99.0]];

const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Icons are cached by look: re-rendering a marker with an identical icon object does not touch its DOM,
// so hovering one pin no longer rebuilds every marker on the map.
const iconCache = new Map<string, L.DivIcon>();
const cached = (key: string, make: () => L.DivIcon): L.DivIcon => {
  let icon = iconCache.get(key);
  if (!icon) { icon = make(); iconCache.set(key, icon); }
  return icon;
};

const pinIcon = (label: string, warn: boolean, selected: boolean, muted: boolean) =>
  cached(`p|${label}|${+warn}|${+selected}|${+muted}`, () => L.divIcon({
    className: 'hc-pin',
    html: `<span class="hc-pin-dot${muted ? ' hc-pin-muted' : warn ? ' hc-pin-warn' : ''}${selected ? ' hc-pin-sel' : ''}">${label}</span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  }));

const dotIcon = (muted: boolean, selected: boolean) =>
  cached(`d|${+muted}|${+selected}`, () => L.divIcon({ className: 'hc-pin', html: `<span class="hc-dot${muted ? ' hc-dot-muted' : ''}${selected ? ' hc-pin-sel' : ''}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9] }));

const youIcon = (label: string) =>
  L.divIcon({ className: 'hc-pin', html: `<span class="hc-you"></span><span class="hc-you-label">${label}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });

/** Fits the view once per change of `fitKey` (not on every re-render), so a manual zoom or pan is not undone. */
function FitBounds({ bounds, fitKey }: { bounds: LatLngBoundsExpression; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    // Leave room for the map switch (top) and the legend (bottom).
    const small = map.getSize().y < 400;
    map.fitBounds(bounds, small ? { padding: [24, 24], maxZoom: 14 } : { paddingTopLeft: [48, 96], paddingBottomRight: [48, 150], maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

/** Points on a circle of radiusKm around a centre (for the outside-radius shading). */
function circleRing(c: Point, radiusKm: number, steps = 120): [number, number][] {
  const dLat = (radiusKm / 6371) * (180 / Math.PI);
  const dLon = dLat / Math.cos((c.lat * Math.PI) / 180);
  return Array.from({ length: steps }, (_, i) => {
    const a = (2 * Math.PI * i) / steps;
    return [c.lat + dLat * Math.sin(a), c.lon + dLon * Math.cos(a)];
  });
}
/** Covers the whole map; the radius circle is cut out of it so everything outside the radius is greyed. */
const WORLD_RING: [number, number][] = [[-85, -179.9], [-85, 179.9], [85, 179.9], [85, -179.9]];

const MIN_PX = 40;
/**
 * At the current zoom, pins closer than MIN_PX on screen are pushed apart (pairwise relaxation, repeated until none
 * overlap or 60 passes), so no number hides another, including pins that a first nudge would have pushed onto a neighbour.
 */
function spreadOnScreen(map: L.Map, points: StreetPoint[]): StreetPoint[] {
  const px = points.map((p) => map.project([p.lat, p.lon]));
  const pos = px.map((q, i) => ({ x: q.x + (i % 2 ? 0.01 : -0.01) * (i + 1), y: q.y + (i % 3 ? 0.01 : -0.01) * (i + 1) }));
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const dist = Math.hypot(dx, dy);
        if (dist >= MIN_PX) continue;
        const ux = dist > 0.001 ? dx / dist : Math.cos(i + j);
        const uy = dist > 0.001 ? dy / dist : Math.sin(i + j);
        const push = (MIN_PX - dist) / 2 + 0.5;
        pos[i].x -= ux * push; pos[i].y -= uy * push;
        pos[j].x += ux * push; pos[j].y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return points.map((p, i) => {
    if (Math.hypot(pos[i].x - px[i].x, pos[i].y - px[i].y) < 1) return p;
    const ll = map.unproject([pos[i].x, pos[i].y]);
    return { ...p, lat: ll.lat, lon: ll.lng };
  });
}

/** One marker; memoised so a hover elsewhere does not re-render (and re-bind) every marker. */
const PinMarker = memo(function PinMarker({ p, selected, onSelect, onHover }: { p: StreetPoint; selected: boolean; onSelect: (id: string) => void; onHover: (id: string | null) => void }) {
  const handlers = useMemo(() => ({ click: () => onSelect(p.id), mouseover: () => onHover(p.id), mouseout: () => onHover(null) }), [p.id, onSelect, onHover]);
  return (
    <Marker position={[p.lat, p.lon]} icon={p.dot ? dotIcon(!!p.muted, selected) : pinIcon(p.label, !!p.warn, selected, !!p.muted)} title={`${p.label}. ${p.name}`} alt={`${p.label}. ${p.name}`} eventHandlers={handlers}>
      <Tooltip direction="top" offset={[0, p.dot ? -8 : -18]}>{`${p.label}. ${p.name}`}</Tooltip>
    </Marker>
  );
});

function Pins({ points, origin, selectedId, onSelect }: { points: StreetPoint[]; origin: Point; selectedId?: string | null; onSelect?: (id: string) => void }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  const [hover, setHover] = useState<string | null>(null);
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  // Re-spread whenever the pin set changes (not only on zoom).
  const key = points.map((p) => `${p.id}:${p.lat}:${p.lon}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // Only numbered pins are spread apart; dots keep their real position.
  const placed = useMemo(() => [...points.filter((p) => p.dot), ...spreadOnScreen(map, points.filter((p) => !p.dot))], [map, key, zoom]);
  const lineTo = placed.find((p) => p.id === (hover ?? selectedId));
  // Stable select callback (the parent's may be a new arrow each render).
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const select = useMemo(() => (id: string) => selectRef.current?.(id), []);
  return (
    <>
      {lineTo && <Polyline positions={[[origin.lat, origin.lon], [lineTo.lat, lineTo.lon]]} pathOptions={{ color: '#4f5b58', weight: 1.5, dashArray: '2 6', opacity: 0.8 }} />}
      {placed.map((p) => <PinMarker key={p.id} p={p} selected={p.id === selectedId} onSelect={select} onHover={setHover} />)}
    </>
  );
}

export function StreetMap({ origin, points, radiusKm, selectedId, onSelect, ariaLabel, youLabel }: { origin: Point; points: StreetPoint[]; radiusKm?: number; selectedId?: string | null; onSelect?: (id: string) => void; ariaLabel: string; youLabel: string }) {
  // Fit to you plus the numbered pins of the list (not every dot or far grey place, which zoomed the map out too far).
  // With no numbered pins, fall back to the radius circle, then to all points.
  const focus = points.filter((p) => !p.dot && !p.muted);
  const fitKey = `${origin.lat},${origin.lon}|${radiusKm ?? ''}|${(focus.length ? focus : points).map((p) => p.id).join(',')}`;
  const bounds = useMemo<LatLngBoundsExpression>(() => {
    const pts = focus.length ? focus : [];
    if (pts.length) return [[origin.lat, origin.lon] as [number, number], ...pts.map((p) => [p.lat, p.lon] as [number, number])];
    if (radiusKm) {
      const dLat = radiusKm / 111;
      const dLon = dLat / Math.cos((origin.lat * Math.PI) / 180);
      return [[origin.lat - dLat, origin.lon - dLon], [origin.lat + dLat, origin.lon + dLon]];
    }
    const all = [[origin.lat, origin.lon] as [number, number], ...points.map((p) => [p.lat, p.lon] as [number, number])];
    return all.length > 1 ? all : [[origin.lat - 0.2, origin.lon - 0.2], [origin.lat + 0.2, origin.lon + 0.2]];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return (
    <div className="h-full w-full" role="region" aria-label={ariaLabel}>
      <MapContainer center={[origin.lat, origin.lon]} zoom={10} minZoom={5} maxZoom={18} zoomSnap={0.5} zoomDelta={0.5} wheelPxPerZoomLevel={90} maxBounds={INDIA_BOUNDS} maxBoundsViscosity={1} className="h-full w-full" scrollWheelZoom attributionControl zoomControl={false}>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
        <ZoomControl position="bottomright" />
        <FitBounds bounds={bounds} fitKey={fitKey} />
        {radiusKm && (
          <Polygon positions={[WORLD_RING, circleRing(origin, radiusKm)]} interactive={false} pathOptions={{ stroke: false, fillColor: '#1f2a28', fillOpacity: 0.3 }} />
        )}
        {radiusKm && <Circle center={[origin.lat, origin.lon]} radius={radiusKm * 1000} pathOptions={{ color: '#0b5f58', weight: 2, dashArray: '8 6', fill: false }} />}
        <Marker position={[origin.lat, origin.lon]} icon={youIcon(youLabel)} keyboard={false} />
        <Pins points={points} origin={origin} selectedId={selectedId} onSelect={onSelect} />
      </MapContainer>
    </div>
  );
}
