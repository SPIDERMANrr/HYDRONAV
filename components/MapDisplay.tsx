import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Sun, Moon } from 'lucide-react';
import { Coordinate, RouteData, FloodZone } from '../types';

// Fix Leaflet default icon issues
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// --- HELPER: Validate Coordinates to prevent Leaflet Crashes ---
const isValidCoordinate = (coord: Coordinate | null | undefined): boolean => {
    return !!coord && 
           typeof coord.lat === 'number' && !isNaN(coord.lat) && isFinite(coord.lat) &&
           typeof coord.lng === 'number' && !isNaN(coord.lng) && isFinite(coord.lng);
};

// --- CUSTOM FUTURISTIC ICONS ---

const createCarIcon = (heading: number) => L.divIcon({
  html: `
    <div style="transform: rotate(${heading}deg);" class="relative flex items-center justify-center w-16 h-16 -ml-5 -mt-5 smooth-marker-transition">
        <div class="absolute inset-0 bg-cyan-500 rounded-full opacity-20 animate-ping"></div>
        <div class="absolute inset-0 bg-cyan-500/40 rounded-full blur-md"></div>
        <!-- Arrow Shape -->
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-10 h-10 text-cyan-400 relative z-10 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]">
             <path d="M12 2L2 22l10-3 10 3L12 2z" />
        </svg>
    </div>
  `,
  className: 'bg-transparent',
  iconSize: [64, 64],
  iconAnchor: [32, 32],
});

const destIcon = L.divIcon({
  html: `
    <div class="relative flex items-center justify-center w-10 h-10 -ml-2 -mt-4">
        <div class="absolute bottom-0 w-3 h-1 bg-red-500 blur-sm rounded-full"></div>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-8 h-8 text-rose-500 relative z-10 drop-shadow-[0_0_10px_rgba(244,63,94,1)]">
            <path fill-rule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
        </svg>
    </div>
  `,
  className: 'bg-transparent',
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -35]
});

interface MapProps {
  id: string;
  center: Coordinate;
  zoom: number;
  userLocation: Coordinate | null;
  destination: Coordinate | null;
  route: RouteData | null;
  floodZones: FloodZone[];
  tempHazardPoints?: Coordinate[]; 
  onMapClick?: (lat: number, lng: number) => void;
  interactive?: boolean;
  isRisk?: boolean;
  activeTool?: 'none' | 'destination' | 'hazard';
  is3DMode?: boolean;
  heading?: number;
  pathTrail?: Coordinate[]; 
}

const MapDisplay: React.FC<MapProps> = ({
  id,
  center,
  zoom,
  userLocation,
  destination,
  route,
  floodZones,
  tempHazardPoints = [],
  onMapClick,
  interactive = true,
  isRisk = false,
  activeTool = 'none',
  is3DMode = false,
  heading = 0,
  pathTrail = []
}) => {
  const mapRef = useRef<L.Map | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const trailLineRef = useRef<L.Polyline | null>(null);
  const floodLayersRef = useRef<L.Polygon[]>([]);
  const drawLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  
  const onMapClickRef = useRef(onMapClick);
  
  // Map Style State: 'dark' or 'light'
  const [mapStyle, setMapStyle] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  // --- INITIALIZATION ---
  useEffect(() => {
    if (!mapRef.current) {
      // Validate initial center, fallback if invalid
      const initialLat = isValidCoordinate(center) ? center.lat : 0;
      const initialLng = isValidCoordinate(center) ? center.lng : 0;

      // Initialize Map
      mapRef.current = L.map(id, {
        zoomControl: false, 
        dragging: interactive,
        scrollWheelZoom: interactive,
        doubleClickZoom: interactive,
        attributionControl: true,
        boxZoom: false,
        keyboard: false,
        zoomAnimation: true,
        fadeAnimation: true,
        markerZoomAnimation: true
      }).setView([initialLat, initialLng], zoom);

      // Add default tile layer immediately
      const url = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
      tileLayerRef.current = L.tileLayer(url, {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20,
        className: 'dark-map-tiles',
        crossOrigin: true
      }).addTo(mapRef.current);

      drawLayerRef.current = L.layerGroup().addTo(mapRef.current);

      mapRef.current.on('click', (e) => {
        if (onMapClickRef.current) {
          onMapClickRef.current(e.latlng.lat, e.latlng.lng);
        }
      });

      // Immediate resize to ensure tiles load
      requestAnimationFrame(() => {
         mapRef.current?.invalidateSize();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]); 
  
  // --- MAP STYLE SWITCHER (Dark/Light) ---
  useEffect(() => {
    if (!mapRef.current) return;
    
    const isDark = mapStyle === 'dark';
    const url = isDark 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    
    const className = isDark ? 'dark-map-tiles' : '';

    if (tileLayerRef.current) {
        mapRef.current.removeLayer(tileLayerRef.current);
    }

    tileLayerRef.current = L.tileLayer(url, {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20,
        className: className,
        crossOrigin: true
    }).addTo(mapRef.current);

  }, [mapStyle]);

  // --- 3D Mode & Rotation Logic ---
  useEffect(() => {
      if(!mapRef.current) return;
      const container = mapRef.current.getContainer();
      
      if (is3DMode) {
          container.parentElement?.classList.add('map-container-3d');
          container.classList.add('map-view-3d');
          container.classList.remove('map-view-normal');
          
          const pane = mapRef.current.getPane('mapPane');
          if (pane) {
              pane.style.transformOrigin = 'center 80%'; 
              pane.style.transform = `rotateX(55deg) rotateZ(-${heading}deg) scale(1.6)`;
          }

      } else {
          container.parentElement?.classList.remove('map-container-3d');
          container.classList.remove('map-view-3d');
          container.classList.add('map-view-normal');
          
          const pane = mapRef.current.getPane('mapPane');
          if (pane) {
              pane.style.transform = '';
          }
      }
  }, [is3DMode, heading]);

  // --- View Control ---
  useEffect(() => {
    if (mapRef.current) {
        if (is3DMode && isValidCoordinate(userLocation)) {
            mapRef.current.setView([userLocation!.lat, userLocation!.lng], 19, { animate: true, duration: 0.5 });
        } else if (isValidCoordinate(center)) {
            mapRef.current.flyTo([center.lat, center.lng], zoom, { 
                animate: true, 
                duration: 1.5
            });
        }
    }
  }, [center, zoom, is3DMode, userLocation]);

  // --- User Marker ---
  useEffect(() => {
    if (!mapRef.current) return;
    
    if (isValidCoordinate(userLocation)) {
      const icon = createCarIcon(heading);
      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng([userLocation!.lat, userLocation!.lng]);
        userMarkerRef.current.setIcon(icon);
      } else {
        userMarkerRef.current = L.marker([userLocation!.lat, userLocation!.lng], { icon })
          .addTo(mapRef.current);
      }
    }
  }, [userLocation, heading]);

  // --- Trail (Breadcrumbs) ---
  useEffect(() => {
      if (!mapRef.current) return;
      
      const validTrail = pathTrail.filter(isValidCoordinate);

      if (validTrail.length > 1) {
          const latlngs = validTrail.map(p => [p.lat, p.lng] as [number, number]);
          if (!trailLineRef.current) {
              trailLineRef.current = L.polyline(latlngs, {
                  color: mapStyle === 'dark' ? '#06b6d4' : '#0ea5e9',
                  weight: 4,
                  opacity: 0.4,
                  dashArray: '10, 15',
                  lineCap: 'round'
              }).addTo(mapRef.current);
          } else {
              trailLineRef.current.setLatLngs(latlngs);
              trailLineRef.current.setStyle({ color: mapStyle === 'dark' ? '#06b6d4' : '#0ea5e9' });
          }
      }
  }, [pathTrail, mapStyle]);

  // --- Destination Marker ---
  useEffect(() => {
    if (!mapRef.current) return;
    
    if (isValidCoordinate(destination)) {
      if (destMarkerRef.current) {
        destMarkerRef.current.setLatLng([destination!.lat, destination!.lng]);
      } else {
        destMarkerRef.current = L.marker([destination!.lat, destination!.lng], { icon: destIcon })
          .addTo(mapRef.current)
          .bindPopup("<div class='font-bold text-rose-600'>Target Location</div>");
      }
    } else if (destMarkerRef.current) {
        destMarkerRef.current.remove();
        destMarkerRef.current = null;
    }
  }, [destination]);

  // --- Route Polyline ---
  useEffect(() => {
    if (!mapRef.current) return;

    if (route && route.coordinates && route.coordinates.length > 0) {
        // Strict Validation to prevent NaN errors
        const latlngs = route.coordinates
            .filter(isValidCoordinate)
            .map(c => [c.lat, c.lng] as [number, number]);

        if (latlngs.length === 0) return;

        const color = isRisk ? '#f43f5e' : (mapStyle === 'dark' ? '#06b6d4' : '#0284c7'); 

        if (routeLineRef.current) {
            routeLineRef.current.setLatLngs(latlngs);
            routeLineRef.current.setStyle({ color }); 
            const el = routeLineRef.current.getElement();
            if (el) {
                el.classList.remove('route-pulse');
                void el.offsetWidth; 
                el.classList.add('route-pulse');
            }
        } else {
            routeLineRef.current = L.polyline(latlngs, { 
                color, 
                weight: 8, 
                opacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(mapRef.current);
            
             setTimeout(() => {
                const el = routeLineRef.current?.getElement();
                if(el) el.classList.add('route-pulse');
            }, 100);
        }
    } else if (routeLineRef.current) {
        routeLineRef.current.remove();
        routeLineRef.current = null;
    }
  }, [route, interactive, isRisk, mapStyle]);

  // --- Flood Zones ---
  useEffect(() => {
    if (!mapRef.current) return;

    floodLayersRef.current.forEach(layer => layer.remove());
    floodLayersRef.current = [];

    floodZones.forEach(zone => {
        const polygonCoords = zone.polygon
            .filter(isValidCoordinate)
            .map(p => [p.lat, p.lng] as [number, number]);
        
        if (polygonCoords.length < 3) return;

        const poly = L.polygon(polygonCoords, {
            className: 'flood-zone-border',
            color: '#f43f5e', 
            fillColor: 'url(#diagonal-hazard)', 
            fillOpacity: 0.6, 
            weight: 2
        }).addTo(mapRef.current!);
        
        floodLayersRef.current.push(poly);
    });
  }, [floodZones]);

  // --- Drawing Mode ---
  useEffect(() => {
      if (!mapRef.current || !drawLayerRef.current) return;
      drawLayerRef.current.clearLayers();

      if (tempHazardPoints.length > 0) {
          const latlngs = tempHazardPoints
            .filter(isValidCoordinate)
            .map(p => [p.lat, p.lng] as [number, number]);
          
          if (latlngs.length > 0) {
              L.polyline(latlngs, {
                  color: '#fbbf24', 
                  weight: 2,
                  dashArray: '5, 5',
                  opacity: 0.8
              }).addTo(drawLayerRef.current);

              latlngs.forEach((ll) => {
                  L.circleMarker(ll, {
                      radius: 4,
                      fillColor: '#fbbf24',
                      color: '#fff',
                      weight: 1,
                      fillOpacity: 1
                  }).addTo(drawLayerRef.current!);
              });
          }
      }
  }, [tempHazardPoints]);

  return (
    <div className="relative w-full h-full group">
        <div id={id} className="w-full h-full bg-slate-900" />
        
        {/* Toggle Map Style Button */}
        <button 
            onClick={() => setMapStyle(prev => prev === 'dark' ? 'light' : 'dark')}
            className={`
                absolute bottom-32 right-4 z-[400] 
                p-2.5 rounded-xl border shadow-xl transition-all duration-300 hover:scale-105
                ${mapStyle === 'dark' 
                    ? 'bg-slate-800/80 border-slate-700 text-amber-400 hover:bg-slate-700' 
                    : 'bg-white/90 border-slate-200 text-slate-700 hover:bg-white'}
                backdrop-blur-md
            `}
            title={mapStyle === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
            {mapStyle === 'dark' ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
        </button>
    </div>
  );
};

export default React.memo(MapDisplay);