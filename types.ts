export interface Coordinate {
  lat: number;
  lng: number;
}

export interface FloodZone {
  id: string;
  name: string;
  polygon: Coordinate[]; // Array of points defining the polygon
  center: Coordinate;
  radius: number; // Approximate radius in meters for simple circular zones
  type: 'manual_polygon' | 'geocoded_area' | 'circular_risk';
}

export interface RouteManeuver {
  type: string;
  modifier?: string;
  location: [number, number];
  bearing_before: number;
  bearing_after: number;
}

export interface RouteStep {
  distance: number; // meters
  duration: number; // seconds
  geometry: string; // polyline
  weight: number;
  name: string;
  ref?: string;
  maneuver: RouteManeuver;
  mode: string;
  driving_side: string;
}

export interface RouteData {
  coordinates: Coordinate[]; // The path geometry
  totalDistance: number;
  totalDuration: number;
  bbox?: [number, number, number, number];
  steps: RouteStep[];
}

export interface NavigationStatus {
  isNavigating: boolean;
  distanceTraveled: number;
  distanceRemaining: number;
  eta: string;
  alert: string | null;
  rerouting: boolean;
  currentSpeed: number;
  speedLimit: number;
  currentStepIndex: number;
  nextManeuver: string;
  distToManeuver: number;
  heading: number; // Current bearing 0-360
}

export interface PlaceSuggestion {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
}