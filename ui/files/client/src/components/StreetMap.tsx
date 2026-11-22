import { useEffect, useMemo } from 'react';
import { Circle, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, ZoomControl, useMap } from 'react-leaflet';
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

const pinIcon = (label: string, warn: boolean, selected: boolean, muted: boolean) =>
  L.divIcon({
    className: 'hc-pin',
    html: `<span class="hc-pin-dot${muted ? ' hc-pin-muted' : warn ? ' hc-pin-warn' : ''}${selected ? ' hc-pin-sel' : ''}">${label}</span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });

const youIcon = (label: string) =>
  L.divIcon({ className: 'hc-pin', html: `<span class="hc-you"></span><span class="hc-you-label">${label}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    // Leave room for the map switch (top) and the legend (bottom).
    map.fitBounds(bounds, { paddingTopLeft: [48, 96], paddingBottomRight: [48, 150], maxZoom: 13 });
  }, [map, bounds]);
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

/** Spread pins that share (almost) the same spot so every number stays readable. */
function spread(points: StreetPoint[], origin: Point): StreetPoint[] {
  // The user's own position counts as occupied, so a pin never hides under "You".
  const seen = new Map<string, number>([[`${origin.lat.toFixed(2)},${origin.lon.toFixed(2)}`, 1]]);
  return points.map((p) => {
    const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) return p;
    const angle = (n * 2 * Math.PI) / 6;
    return { ...p, lat: p.lat + 0.012 * Math.sin(angle), lon: p.lon + 0.012 * Math.cos(angle) };
  });
}

export function StreetMap({ origin, points, radiusKm, selectedId, onSelect, ariaLabel, youLabel }: { origin: Point; points: StreetPoint[]; radiusKm?: number; selectedId?: string | null; onSelect?: (id: string) => void; ariaLabel: string; youLabel: string }) {
  const placed = useMemo(() => spread(points, origin), [points, origin]);
  const bounds = useMemo<LatLngBoundsExpression>(() => {
    const all = [[origin.lat, origin.lon] as [number, number], ...placed.map((p) => [p.lat, p.lon] as [number, number])];
    return all.length > 1 ? all : [[origin.lat - 0.2, origin.lon - 0.2], [origin.lat + 0.2, origin.lon + 0.2]];
  }, [origin, placed]);
  return (
    <div className="h-full w-full" role="region" aria-label={ariaLabel}>
      <MapContainer center={[origin.lat, origin.lon]} zoom={10} minZoom={5} maxBounds={INDIA_BOUNDS} maxBoundsViscosity={1} className="h-full w-full" scrollWheelZoom attributionControl zoomControl={false}>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
        <ZoomControl position="bottomright" />
        <FitBounds bounds={bounds} />
        {radiusKm && (
          <Polygon positions={[WORLD_RING, circleRing(origin, radiusKm)]} interactive={false} pathOptions={{ stroke: false, fillColor: '#1f2a28', fillOpacity: 0.3 }} />
        )}
        {radiusKm && <Circle center={[origin.lat, origin.lon]} radius={radiusKm * 1000} pathOptions={{ color: '#0b5f58', weight: 2, dashArray: '8 6', fill: false }} />}
        {placed.map((p) => (
          <Polyline key={`l-${p.id}`} positions={[[origin.lat, origin.lon], [p.lat, p.lon]]} pathOptions={{ color: '#4f5b58', weight: 1.5, dashArray: '2 6', opacity: 0.7 }} />
        ))}
        <Marker position={[origin.lat, origin.lon]} icon={youIcon(youLabel)} keyboard={false} />
        {placed.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lon]} icon={pinIcon(p.label, !!p.warn, p.id === selectedId, !!p.muted)} title={`${p.label}. ${p.name}`} alt={`${p.label}. ${p.name}`} eventHandlers={{ click: () => onSelect?.(p.id) }}>
            <Tooltip direction="top" offset={[0, -18]}>{`${p.label}. ${p.name}`}</Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
