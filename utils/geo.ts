import { Coordinate, FloodZone } from '../types';

// Earth radius in meters
const R = 6371000;

export const haversineDistance = (c1: Coordinate, c2: Coordinate): number => {
  const dLat = (c2.lat - c1.lat) * (Math.PI / 180);
  const dLon = (c2.lng - c1.lng) * (Math.PI / 180);
  const lat1 = c1.lat * (Math.PI / 180);
  const lat2 = c2.lat * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const calculateBearing = (start: Coordinate, end: Coordinate): number => {
  const startLat = start.lat * (Math.PI / 180);
  const startLng = start.lng * (Math.PI / 180);
  const endLat = end.lat * (Math.PI / 180);
  const endLng = end.lng * (Math.PI / 180);

  const y = Math.sin(endLng - startLng) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat) -
            Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLng - startLng);
  const brng = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return brng;
};

export const calculateSpeed = (distMeters: number, timeDeltaMs: number): number => {
    if (timeDeltaMs <= 0) return 0;
    const speedMPS = distMeters / (timeDeltaMs / 1000);
    return speedMPS * 3.6; // Convert to km/h
};

// Simple Low-Pass Filter to smooth GPS jitter
export class LocationSmoother {
    private lastLat: number | null = null;
    private lastLng: number | null = null;
    private alpha: number = 0.3; // 0.3 means 30% new data, 70% old data (smoother but laggy)

    smooth(lat: number, lng: number): Coordinate {
        if (this.lastLat === null || this.lastLng === null) {
            this.lastLat = lat;
            this.lastLng = lng;
            return { lat, lng };
        }
        
        // Low pass filter
        const smoothedLat = this.lastLat + this.alpha * (lat - this.lastLat);
        const smoothedLng = this.lastLng + this.alpha * (lng - this.lastLng);

        this.lastLat = smoothedLat;
        this.lastLng = smoothedLng;

        return { lat: smoothedLat, lng: smoothedLng };
    }
}

// Check if a point is roughly inside a polygon (using Ray Casting algorithm)
export const isPointInPolygon = (point: Coordinate, vs: Coordinate[]): boolean => {
  const x = point.lng, y = point.lat;
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].lng, yi = vs[i].lat;
    const xj = vs[j].lng, yj = vs[j].lat;

    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// Check if a line segment intersects a polygon
export const doesRouteIntersectFlood = (routePath: Coordinate[], floodZone: FloodZone): boolean => {
  // 1. Bounding box check first for performance
  const floodLats = floodZone.polygon.map(p => p.lat);
  const floodLngs = floodZone.polygon.map(p => p.lng);
  const minLat = Math.min(...floodLats);
  const maxLat = Math.max(...floodLats);
  const minLng = Math.min(...floodLngs);
  const maxLng = Math.max(...floodLngs);

  // Broad phase: Check if route bbox overlaps flood bbox
  const routeLats = routePath.map(p => p.lat);
  const routeLngs = routePath.map(p => p.lng);
  const rMinLat = Math.min(...routeLats);
  const rMaxLat = Math.max(...routeLats);
  const rMinLng = Math.min(...routeLngs);
  const rMaxLng = Math.max(...routeLngs);

  if (rMaxLat < minLat || rMinLat > maxLat || rMaxLng < minLng || rMinLng > maxLng) {
      return false; 
  }

  // Narrow phase: Check every point.
  // Optimization: Only check points that are inside the bbox of the flood zone
  const margin = 0.001;
  
  for (let i = 0; i < routePath.length; i++) {
    const p = routePath[i];
    if (p.lat >= minLat - margin && p.lat <= maxLat + margin && 
        p.lng >= minLng - margin && p.lng <= maxLng + margin) {
      
      if (isPointInPolygon(p, floodZone.polygon)) {
        return true;
      }
    }
  }
  return false;
};

// Calculate a 'Hazard Score' for a route.
export const calculateRouteHazardScore = (routePath: Coordinate[], floodZones: FloodZone[]): number => {
    let score = 0;
    
    // Performance: Filter relevant zones first
    const relevantZones = floodZones.filter(zone => {
        // Simple bbox check
        const lats = zone.polygon.map(p => p.lat); const lngs = zone.polygon.map(p => p.lng);
        const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
        
        const rLats = routePath.map(p => p.lat); const rLngs = routePath.map(p => p.lng);
        const rMinLat = Math.min(...rLats); const rMaxLat = Math.max(...rLats);
        const rMinLng = Math.min(...rLngs); const rMaxLng = Math.max(...rLngs);

        return !(rMaxLat < minLat || rMinLat > maxLat || rMaxLng < minLng || rMinLng > maxLng);
    });

    if (relevantZones.length === 0) return 0;

    // Check every point against relevant zones
    for (const p of routePath) {
        let pointInDanger = false;
        for (const zone of relevantZones) {
             if (isPointInPolygon(p, zone.polygon)) {
                 pointInDanger = true;
                 break;
             }
        }
        if (pointInDanger) score++;
    }

    return score;
};

// Calculate a specific offset point
const calculateOffsetPoint = (start: Coordinate, end: Coordinate, center: Coordinate, multiplier: number, radiusMeters: number): Coordinate => {
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  const len = Math.sqrt(dx*dx + dy*dy);
  if (len === 0) return center;

  const perpX = -dy / len;
  const perpY = dx / len;
  
  const radiusInDegrees = radiusMeters / 111111;
  const offsetAmount = radiusInDegrees * multiplier;
  
  return {
    lat: center.lat + (perpY * offsetAmount),
    lng: center.lng + (perpX * offsetAmount)
  };
};

export const getExpandedBoundingBoxCorners = (zone: FloodZone, expansionFactor: number): Coordinate[] => {
    const lats = zone.polygon.map(p => p.lat);
    const lngs = zone.polygon.map(p => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    const latMargin = (latSpan * (expansionFactor - 1)) / 2;
    const lngMargin = (lngSpan * (expansionFactor - 1)) / 2;

    return [
        { lat: maxLat + latMargin, lng: minLng - lngMargin }, // TL
        { lat: maxLat + latMargin, lng: maxLng + lngMargin }, // TR
        { lat: minLat - latMargin, lng: maxLng + lngMargin }, // BR
        { lat: minLat - latMargin, lng: minLng - lngMargin }, // BL
    ];
};

export interface DetourCandidate {
    type: string;
    waypoint: Coordinate;
}

// Generate a diverse set of candidate waypoints to route around a hazard
export const generateDetourWaypoints = (start: Coordinate, end: Coordinate, hazard: FloodZone): DetourCandidate[] => {
    const candidates: DetourCandidate[] = [];

    // 1. Perpendicular Offsets (Left and Right)
    // Tries to push the route to the side of the hazard
    candidates.push({ type: 'Perpendicular Left (Tight)', waypoint: calculateOffsetPoint(start, end, hazard.center, 1.5, hazard.radius) });
    candidates.push({ type: 'Perpendicular Right (Tight)', waypoint: calculateOffsetPoint(start, end, hazard.center, -1.5, hazard.radius) });
    candidates.push({ type: 'Perpendicular Left (Wide)', waypoint: calculateOffsetPoint(start, end, hazard.center, 3.0, hazard.radius) });
    candidates.push({ type: 'Perpendicular Right (Wide)', waypoint: calculateOffsetPoint(start, end, hazard.center, -3.0, hazard.radius) });

    // 2. Bounding Box Corners
    // Useful if the hazard is square or rectangular
    const corners = getExpandedBoundingBoxCorners(hazard, 1.3);
    candidates.push({ type: 'Corner Top-Left', waypoint: corners[0] });
    candidates.push({ type: 'Corner Top-Right', waypoint: corners[1] });
    candidates.push({ type: 'Corner Bottom-Right', waypoint: corners[2] });
    candidates.push({ type: 'Corner Bottom-Left', waypoint: corners[3] });

    return candidates;
};

export const formatDistance = (meters: number): string => {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
};

export const formatDuration = (seconds: number): string => {
  const min = Math.floor(seconds / 60);
  if (min > 60) {
    const hrs = Math.floor(min / 60);
    const m = min % 60;
    return `${hrs}h ${m}m`;
  }
  return `${min} min`;
};