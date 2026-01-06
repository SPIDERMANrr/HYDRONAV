import { Coordinate, RouteData, FloodZone, PlaceSuggestion, RouteStep } from '../types';
import { 
    doesRouteIntersectFlood, 
    calculateRouteHazardScore, 
    haversineDistance, 
    generateDetourWaypoints 
} from '../utils/geo';

const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1/driving';
const OSRM_BACKUP_URL = 'https://routing.openstreetmap.de/routed-car/route/v1/driving';
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org/search';

// Helper to perform the actual API call with fallback
const fetchOSRMRoute = async (coordinates: Coordinate[]): Promise<any> => {
    // Validate coordinates before making request
    const validCoords = coordinates.filter(c => 
        c && !isNaN(c.lat) && !isNaN(c.lng) && isFinite(c.lat) && isFinite(c.lng)
    );

    if (validCoords.length < 2) {
        console.warn("Insufficient valid coordinates for routing");
        return null;
    }

    const coordString = validCoords.map(c => `${c.lng},${c.lat}`).join(';');
    // Request steps=true for turn-by-turn instructions
    const buildUrl = (base: string) => `${base}/${coordString}?overview=full&geometries=geojson&steps=true`;

    const performFetch = async (url: string) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); 
        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`Status: ${response.status}`);
            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    };

    try {
        // Try Primary
        return await performFetch(buildUrl(OSRM_BASE_URL));
    } catch (primaryError) {
        console.warn("Primary OSRM server failed. Attempting backup...", primaryError);
        try {
            // Try Backup
            return await performFetch(buildUrl(OSRM_BACKUP_URL));
        } catch (backupError) {
            console.error("OSRM Fetch Error: All providers failed.", backupError);
            return null; 
        }
    }
};

const transformRouteData = (data: any): RouteData | null => {
    if (!data || !data.routes || data.routes.length === 0) return null;
    
    const route = data.routes[0];
    const steps: RouteStep[] = route.legs[0].steps;

    return {
        coordinates: route.geometry.coordinates.map((c: number[]) => ({ lat: c[1], lng: c[0] })),
        totalDistance: route.distance,
        totalDuration: route.duration,
        bbox: route.bbox,
        steps: steps
    };
};

// Helper: Combine multiple flood zones into one logical hazard for routing calculation
const getCombinedHazardZone = (zones: FloodZone[]): FloodZone | null => {
    if (zones.length === 0) return null;
    
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    
    zones.forEach(z => {
        z.polygon.forEach(p => {
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
            if (p.lng < minLng) minLng = p.lng;
            if (p.lng > maxLng) maxLng = p.lng;
        });
    });

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    
    // Estimate effective radius (approx half of diagonal)
    const latDiff = maxLat - minLat;
    const lngDiff = maxLng - minLng;
    const diagonalDeg = Math.sqrt(latDiff*latDiff + lngDiff*lngDiff);
    const radiusMeters = (diagonalDeg / 2) * 111111; 

    return {
        id: 'combined-hazard',
        name: 'Combined Hazard Zone',
        center: { lat: centerLat, lng: centerLng },
        radius: Math.max(radiusMeters, 500), 
        type: 'manual_polygon',
        polygon: [
            { lat: maxLat, lng: minLng }, // TL
            { lat: maxLat, lng: maxLng }, // TR
            { lat: minLat, lng: maxLng }, // BR
            { lat: minLat, lng: minLng }, // BL
        ]
    };
};

interface RouteEvaluation {
    route: RouteData;
    hazardScore: number;
    detourType: string;
}

export const fetchRoute = async (
  start: Coordinate, 
  end: Coordinate, 
  floodZones: FloodZone[] = [],
  avoidHazards: boolean = false
): Promise<RouteData | null> => {
  try {
    // 1. Initial attempt: Direct route
    let data = await fetchOSRMRoute([start, end]);
    let directRoute = transformRouteData(data);

    if (!directRoute) return null;

    if (!avoidHazards) return directRoute;

    // 2. Assess Safety of Direct Route
    const directHazardScore = calculateRouteHazardScore(directRoute.coordinates, floodZones);

    if (directHazardScore === 0) {
        return directRoute;
    }

    // 3. Rerouting Logic
    console.warn(`[RouteEngine] Direct route Unsafe (Score: ${directHazardScore}). Initiating Multi-Path Analysis...`);

    const intersectingZones = floodZones.filter(z => doesRouteIntersectFlood(directRoute!.coordinates, z));
    const metaZone = getCombinedHazardZone(intersectingZones);

    if (metaZone) {
        const candidates = generateDetourWaypoints(start, end, metaZone);
        const evaluationPromises = candidates.map(async (candidate) => {
            const detourData = await fetchOSRMRoute([start, candidate.waypoint, end]);
            const detourRoute = transformRouteData(detourData);
            
            if (!detourRoute) return null;

            return {
                route: detourRoute,
                hazardScore: calculateRouteHazardScore(detourRoute.coordinates, floodZones),
                detourType: candidate.type
            } as RouteEvaluation;
        });

        const results = await Promise.all(evaluationPromises);
        const validEvaluations = results.filter((r): r is RouteEvaluation => r !== null);

        if (validEvaluations.length > 0) {
            validEvaluations.sort((a, b) => {
                if (a.hazardScore !== b.hazardScore) {
                    return a.hazardScore - b.hazardScore; 
                }
                return a.route.totalDistance - b.route.totalDistance;
            });
            return validEvaluations[0].route;
        }
    }
    return directRoute;
  } catch (error) {
    console.error("Routing error:", error);
    return null;
  }
};

export const searchLocation = async (query: string): Promise<Coordinate | null> => {
  try {
    const url = `${NOMINATIM_BASE_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const response = await fetch(url);
    const data = await response.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    return null;
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
};

export const getPlaceSuggestions = async (query: string): Promise<PlaceSuggestion[]> => {
  if (!query || query.length < 3) return [];
  try {
    const url = `${NOMINATIM_BASE_URL}?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5`;
    const response = await fetch(url);
    const data = await response.json();
    return data || [];
  } catch (error) {
    console.error("Suggestion error:", error);
    return [];
  }
};

export const searchAreaPolygon = async (query: string): Promise<FloodZone | null> => {
  try {
    const url = `${NOMINATIM_BASE_URL}?q=${encodeURIComponent(query)}&format=json&limit=1&polygon_geojson=1`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data && data.length > 0) {
      const place = data[0];
      const bbox = place.boundingbox;
      
      let polygon: Coordinate[] = [];
      if (place.geojson && place.geojson.type === 'Polygon') {
          polygon = place.geojson.coordinates[0].map((c: number[]) => ({ lat: c[1], lng: c[0] }));
      } else if (place.geojson && place.geojson.type === 'MultiPolygon') {
           polygon = place.geojson.coordinates[0][0].map((c: number[]) => ({ lat: c[1], lng: c[0] }));
      } else {
            const minLat = parseFloat(bbox[0]);
            const maxLat = parseFloat(bbox[1]);
            const minLng = parseFloat(bbox[2]);
            const maxLng = parseFloat(bbox[3]);
            polygon = [
                { lat: minLat, lng: minLng },
                { lat: maxLat, lng: minLng },
                { lat: maxLat, lng: maxLng },
                { lat: minLat, lng: maxLng },
                { lat: minLat, lng: minLng },
            ];
      }
      
      const center = { lat: parseFloat(place.lat), lng: parseFloat(place.lon) };
      const approxRadius = 1500; 

      return {
        id: `flood-${Date.now()}`,
        name: place.display_name.split(',')[0],
        polygon,
        center,
        radius: approxRadius,
        type: 'geocoded_area'
      };
    }
    return null;
  } catch (error) {
    console.error("Area search error:", error);
    return null;
  }
};