import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  MapPin, 
  Navigation, 
  AlertTriangle, 
  Search, 
  Play, 
  StopCircle,
  ShieldAlert,
  Clock,
  Crosshair,
  Loader2,
  RefreshCw,
  LocateFixed,
  X,
  PenTool,
  Check,
  Menu,
  Layers,
  Zap,
  Wifi,
  CornerUpRight,
  CornerUpLeft,
  ArrowUp,
  Flag,
  Activity,
  Power
} from 'lucide-react';
import MapDisplay from './components/MapDisplay';
import { Coordinate, RouteData, FloodZone, NavigationStatus, PlaceSuggestion } from './types';
import { fetchRoute, searchLocation, searchAreaPolygon, getPlaceSuggestions } from './services/mapService';
import { haversineDistance, formatDistance, formatDuration, doesRouteIntersectFlood, calculateBearing, calculateSpeed, LocationSmoother } from './utils/geo';

// Guntur, Andhra Pradesh, India (Base Location)
const DEFAULT_LOCATION: Coordinate = { lat: 16.3067, lng: 80.4365 };

// Text-to-Speech Helper
const speak = (text: string) => {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(v => v.lang.includes('en') && v.name.includes('Google')) || voices[0];
        if (preferred) utterance.voice = preferred;
        window.speechSynthesis.speak(utterance);
    }
};

const App: React.FC = () => {
  // --- Initialization State ---
  const [isSystemReady, setIsSystemReady] = useState(false);
  const [initStep, setInitStep] = useState(0); // 0: GPS, 1: Map Data, 2: Ready
  const [isResetting, setIsResetting] = useState(false);

  // --- State ---
  const [userLocation, setUserLocation] = useState<Coordinate>(DEFAULT_LOCATION);
  const [viewCenter, setViewCenter] = useState<Coordinate>(DEFAULT_LOCATION); 
  const hasInitialFixRef = useRef(false);
  
  // Breadcrumbs
  const [pathTrail, setPathTrail] = useState<Coordinate[]>([]);
  const locationSmoother = useRef(new LocationSmoother());

  // Tools & UI State
  const [activeTool, setActiveTool] = useState<'none' | 'destination' | 'hazard'>('none');
  const [tempHazardPoints, setTempHazardPoints] = useState<Coordinate[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [destination, setDestination] = useState<Coordinate | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  
  const [floodZones, setFloodZones] = useState<FloodZone[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [floodQuery, setFloodQuery] = useState('');
  
  const [destSuggestions, setDestSuggestions] = useState<PlaceSuggestion[]>([]);
  const [floodSuggestions, setFloodSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isTypingDest, setIsTypingDest] = useState(false);
  const [isTypingFlood, setIsTypingFlood] = useState(false);

  const [isSimulating, setIsSimulating] = useState(false);
  const [isLiveMonitoring, setIsLiveMonitoring] = useState(false);
  
  // Navigation State
  const [navStatus, setNavStatus] = useState<NavigationStatus>({
    isNavigating: false,
    distanceTraveled: 0,
    distanceRemaining: 0,
    eta: '--',
    alert: null,
    rerouting: false,
    currentSpeed: 0,
    speedLimit: 50,
    currentStepIndex: 0,
    nextManeuver: 'Start',
    distToManeuver: 0,
    heading: 0
  });

  // Track start time for Trip Summary
  const [startTime, setStartTime] = useState<number | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [tripStats, setTripStats] = useState({ duration: '', avgSpeed: 0 });

  const simulationInterval = useRef<number | null>(null);
  const liveMonitorInterval = useRef<number | null>(null);
  const simulationIndex = useRef(0);
  const previousLocationRef = useRef<Coordinate>(DEFAULT_LOCATION);
  const lastTimeRef = useRef<number>(Date.now());

  // --- Responsive Init & Boot Sequence ---
  useEffect(() => {
      if (window.innerWidth > 768) setSidebarOpen(true);
      // Fast Boot Sequence
      setTimeout(() => setInitStep(1), 300);
      setTimeout(() => setInitStep(2), 600);
      setTimeout(() => setIsSystemReady(true), 800);
  }, []);

  // --- Voice Setup ---
  useEffect(() => {
      if ('speechSynthesis' in window) {
          window.speechSynthesis.getVoices();
      }
  }, []);

  // --- Real-Time Flood Simulation Logic ---
  useEffect(() => {
      if (isLiveMonitoring) {
          liveMonitorInterval.current = window.setInterval(() => {
             // 20% chance to spawn hazard near user
             if (Math.random() > 0.8) {
                 const baseLoc = userLocation;
                 const latOffset = (Math.random() - 0.5) * 0.03;
                 const lngOffset = (Math.random() - 0.5) * 0.03;
                 
                 const newZone: FloodZone = {
                     id: `live-${Date.now()}`,
                     name: `LIVE ALERT: Sector ${Math.floor(Math.random() * 99)}`,
                     center: { lat: baseLoc.lat + latOffset, lng: baseLoc.lng + lngOffset },
                     radius: 600,
                     type: 'circular_risk',
                     polygon: [
                         { lat: baseLoc.lat + latOffset + 0.004, lng: baseLoc.lng + lngOffset - 0.004 },
                         { lat: baseLoc.lat + latOffset + 0.004, lng: baseLoc.lng + lngOffset + 0.004 },
                         { lat: baseLoc.lat + latOffset - 0.004, lng: baseLoc.lng + lngOffset + 0.004 },
                         { lat: baseLoc.lat + latOffset - 0.004, lng: baseLoc.lng + lngOffset - 0.004 },
                     ]
                 };

                 setFloodZones(prev => [...prev, newZone]);
                 setNavStatus(prev => ({ ...prev, alert: "NEW HAZARD DETECTED" }));
                 speak("Caution. New hazard reported nearby.");
                 setTimeout(() => setNavStatus(prev => ({...prev, alert: null})), 4000);
             }
          }, 3000);
      } else {
          if (liveMonitorInterval.current) clearInterval(liveMonitorInterval.current);
      }
      return () => { if (liveMonitorInterval.current) clearInterval(liveMonitorInterval.current); };
  }, [isLiveMonitoring, userLocation]);

  // --- DYNAMIC HAZARD CHECKING ---
  useEffect(() => {
      if (navStatus.isNavigating && route && floodZones.length > 0 && !navStatus.rerouting) {
          const isCompromised = floodZones.some(z => doesRouteIntersectFlood(route.coordinates, z));
          
          if (isCompromised) {
             console.warn("Route compromised by new hazard!");
             speak("Hazard detected on current path. Rerouting.");
             calculateRoute(userLocation, destination!, floodZones, true, true);
          }
      }
  }, [floodZones, navStatus.isNavigating, route, userLocation, destination]);


  // --- MAIN GEOLOCATION ENGINE ---
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError("GPS N/A");
      return;
    }

    const handleSuccess = (position: GeolocationPosition) => {
        setLocationError(null);
        if (isSimulating) return;

        const rawLat = position.coords.latitude;
        const rawLng = position.coords.longitude;
        
        // Strict Validation
        if (isNaN(rawLat) || isNaN(rawLng)) return;

        // 1. Smooth the GPS data
        const smoothed = locationSmoother.current.smooth(rawLat, rawLng);
        const newLoc = { lat: smoothed.lat, lng: smoothed.lng };

        // 2. Calculate Heading if not provided
        let heading = position.coords.heading;
        if (heading === null || isNaN(heading)) {
             heading = calculateBearing(previousLocationRef.current, newLoc);
        }
        
        // 3. Calculate Speed
        let speed = position.coords.speed ? position.coords.speed * 3.6 : 0;
        if (!speed || speed < 1) {
            const now = Date.now();
            const timeDelta = now - lastTimeRef.current;
            const dist = haversineDistance(previousLocationRef.current, newLoc);
            speed = calculateSpeed(dist, timeDelta); 
            lastTimeRef.current = now;
        }
        
        if (speed < 3) speed = 0;

        setUserLocation(newLoc);
        previousLocationRef.current = newLoc;
        
        setPathTrail(prev => {
            const last = prev[prev.length - 1];
            if (!last || haversineDistance(last, newLoc) > 5) { 
                return [...prev.slice(-49), newLoc]; 
            }
            return prev;
        });

        if (navStatus.isNavigating) {
            const distToDest = destination ? haversineDistance(newLoc, destination) : 0;
            
            setNavStatus(prev => ({
                ...prev,
                currentSpeed: Math.round(speed),
                heading: heading || prev.heading,
                distanceRemaining: distToDest,
                eta: formatDuration((distToDest / 13.4))
            }));

            if (distToDest < 30 && destination) {
                completeNavigation();
            }
        } else {
            // Only center map if not navigating and it's the first fix
            if (!hasInitialFixRef.current) {
                setViewCenter(newLoc);
                hasInitialFixRef.current = true;
            }
        }
    };

    const handleError = (error: GeolocationPositionError) => {
      console.warn("GPS Error", error);
    };

    navigator.geolocation.getCurrentPosition(
        handleSuccess, 
        (err) => console.debug("Quick fix unavailable", err),
        { maximumAge: Infinity, timeout: 1000, enableHighAccuracy: false }
    );

    const options = { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 };
    const id = navigator.geolocation.watchPosition(handleSuccess, handleError, options);
    
    return () => navigator.geolocation.clearWatch(id);
  }, [isSimulating, navStatus.isNavigating, destination]); 


  // --- Routing ---
  const calculateRoute = useCallback(async (start: Coordinate, end: Coordinate, zones: FloodZone[], avoidHazards: boolean = false, isAutoReroute: boolean = false) => {
    // Validate inputs
    if (isNaN(start.lat) || isNaN(start.lng) || isNaN(end.lat) || isNaN(end.lng)) return;

    setIsCalculating(true);
    if (isAutoReroute) setNavStatus(prev => ({ ...prev, rerouting: true, alert: "REROUTING..." }));
    else setNavStatus(prev => ({ ...prev, rerouting: true }));
    
    await new Promise(resolve => setTimeout(resolve, 800));

    const routeData = await fetchRoute(start, end, zones, avoidHazards);
    setRoute(routeData);
    setNavStatus(prev => ({ ...prev, rerouting: false }));
    setIsCalculating(false);
    
    if (routeData) {
        const intersect = zones.some(z => doesRouteIntersectFlood(routeData.coordinates, z));
        setIsBlocked(intersect);
        if (intersect) {
             if (avoidHazards) {
                 setNavStatus(prev => ({ ...prev, alert: "NO SAFE PATH FOUND" }));
             } else {
                 setNavStatus(prev => ({ ...prev, alert: "CRITICAL: HAZARD ON ROUTE" }));
             }
        } else {
             if (isAutoReroute) {
                setNavStatus(prev => ({ ...prev, alert: "REROUTE COMPLETE" }));
                speak("Route updated to avoid hazard.");
                setTimeout(() => setNavStatus(prev => ({ ...prev, alert: null })), 3000);
             } else {
                 const message = avoidHazards ? "SAFE ROUTE LOCKED" : null;
                 setNavStatus(prev => ({ ...prev, alert: message }));
             }
        }
    }
  }, []);

  // Auto-calc route when destination changes
  useEffect(() => {
    if (userLocation && destination) {
        const shouldAvoid = floodZones.length > 0;
        calculateRoute(userLocation, destination, floodZones, shouldAvoid, shouldAvoid);
    }
  }, [destination, floodZones, calculateRoute]); 


  // --- REAL NAVIGATION START ---
  const startRealNavigation = () => {
      if (!route) return;
      setIsSimulating(false);
      setSidebarOpen(false);
      setStartTime(Date.now());
      speak(`Starting navigation. Head towards ${route.steps[0]?.name || 'destination'}.`);
      
      setNavStatus(prev => ({
          ...prev,
          isNavigating: true,
          alert: null,
          currentStepIndex: 0,
          nextManeuver: route.steps[0]?.maneuver?.type || 'Drive'
      }));
  };

  // --- DEMO SIMULATION ---
  const startSimulation = () => { 
      if (!route || route.coordinates.length === 0) return; 
      
      setIsSimulating(true); 
      setSidebarOpen(false); 
      setStartTime(Date.now());
      speak(`Starting simulation. Head towards ${route.steps[0]?.name || 'destination'}.`);

      setNavStatus(prev => ({ 
          ...prev, 
          isNavigating: true,
          currentStepIndex: 0,
          currentSpeed: 0,
          speedLimit: 50 + Math.floor(Math.random() * 30),
          nextManeuver: route.steps[0]?.maneuver?.type || 'Drive'
      })); 
      
      simulationIndex.current = 0; 
      
      simulationInterval.current = window.setInterval(() => { 
          if (!route) return; 
          
          const coords = route.coordinates; 
          const idx = simulationIndex.current; 

          if (idx < coords.length - 1) { 
              const currentPos = coords[idx];
              const nextPos = coords[idx + 1];

              const brng = calculateBearing(currentPos, nextPos);

              setUserLocation(currentPos); 
              setPathTrail(prev => [...prev.slice(-49), currentPos]); 

              simulationIndex.current += 1; 

              setNavStatus(prev => {
                  const targetSpeed = prev.speedLimit - 5 + Math.random() * 10;
                  return {
                     ...prev,
                     heading: brng,
                     currentSpeed: Math.floor(targetSpeed),
                     distanceRemaining: haversineDistance(currentPos, destination!)
                  };
              });
              
              if (Math.random() > 0.98) {
                  const isCompromised = floodZones.some(z => doesRouteIntersectFlood(route.coordinates, z));
                  if (isCompromised && !navStatus.rerouting) {
                       calculateRoute(currentPos, destination!, floodZones, true, true);
                  }
              }

          } else { 
              completeNavigation();
          } 
      }, 200); 
  };

  const completeNavigation = () => {
      stopSimulation(); 
      setNavStatus(prev => ({ ...prev, isNavigating: false, alert: "TARGET REACHED", currentSpeed: 0 }));
      speak("You have arrived at your destination.");
      
      const durationMs = startTime ? Date.now() - startTime : 60000;
      setTripStats({
          duration: formatDuration(durationMs / 1000),
          avgSpeed: 45 
      });
      setShowSummary(true);
  };

  const stopSimulation = () => { 
      if (simulationInterval.current) { 
          clearInterval(simulationInterval.current); 
          simulationInterval.current = null; 
      } 
      setIsSimulating(false); 
      setNavStatus(prev => ({ ...prev, isNavigating: false, alert: null, rerouting: false }));
  };

  const getSpeedColor = () => {
      if (navStatus.currentSpeed > navStatus.speedLimit) return 'text-rose-500 drop-shadow-[0_0_10px_rgba(244,63,94,0.8)]';
      if (navStatus.currentSpeed > navStatus.speedLimit - 5) return 'text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]';
      return 'text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]';
  };

  const getSpeedRingColor = () => {
      if (navStatus.currentSpeed > navStatus.speedLimit) return 'border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.5)]';
      if (navStatus.currentSpeed > navStatus.speedLimit - 5) return 'border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.5)]';
      return 'border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.5)]';
  };

  // --- Handlers ---
  const handleMapClick = (lat: number, lng: number) => {
    // Validate Click
    if (isNaN(lat) || isNaN(lng)) return;

    if (activeTool === 'destination') {
      const coords = { lat, lng };
      setDestination(coords);
      setSearchQuery(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      setIsTypingDest(false);
      setActiveTool('none');
    } else if (activeTool === 'hazard') {
      setTempHazardPoints(prev => [...prev, { lat, lng }]);
    }
  };

  const confirmHazardDrawing = () => {
    if (tempHazardPoints.length < 3) return alert("Need 3+ points");
    const latSum = tempHazardPoints.reduce((acc, p) => acc + p.lat, 0);
    const lngSum = tempHazardPoints.reduce((acc, p) => acc + p.lng, 0);
    const center = { lat: latSum / tempHazardPoints.length, lng: lngSum / tempHazardPoints.length };
    const newZone: FloodZone = { id: `manual-${Date.now()}`, name: "Manual Hazard", center, radius: 500, type: 'manual_polygon', polygon: tempHazardPoints };
    setFloodZones(prev => [...prev, newZone]);
    setTempHazardPoints([]);
    setActiveTool('none');
  };

  const toggleTool = (tool: 'destination' | 'hazard') => {
    setActiveTool(activeTool === tool ? 'none' : tool);
    setTempHazardPoints([]);
  };

  // --- FAST LOCATE HANDLER ---
  const handleLocateMe = () => {
    setIsLocating(true);
    
    // Strategy: Request Fast (Low Accuracy) First, then Refine.
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            if (!isNaN(newLoc.lat) && !isNaN(newLoc.lng)) {
                setUserLocation(newLoc);
                if(!navStatus.isNavigating) setViewCenter(newLoc);
            }
            setIsLocating(false);

            // Refine in background with high accuracy
            navigator.geolocation.getCurrentPosition(
                (refined) => {
                    const refinedLoc = { lat: refined.coords.latitude, lng: refined.coords.longitude };
                    if (!isNaN(refinedLoc.lat) && !isNaN(refinedLoc.lng)) {
                        setUserLocation(refinedLoc);
                        if(!navStatus.isNavigating) setViewCenter(refinedLoc);
                    }
                },
                null, 
                { enableHighAccuracy: true, timeout: 10000 }
            );
        },
        () => {
             setIsLocating(false);
        },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: Infinity }
    );
  };

  const handleDestinationSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery) return;
    const coords = await searchLocation(searchQuery);
    if (coords && !isNaN(coords.lat) && !isNaN(coords.lng)) { 
        setDestination(coords); 
        setViewCenter(coords); 
        setDestSuggestions([]); 
        setIsTypingDest(false);
    }
  };

  const handleSelectDestination = (suggestion: PlaceSuggestion) => {
    setSearchQuery(suggestion.display_name);
    setDestSuggestions([]);
    setIsTypingDest(false);
    const lat = parseFloat(suggestion.lat);
    const lng = parseFloat(suggestion.lon);
    if (!isNaN(lat) && !isNaN(lng)) {
        const coords = { lat, lng };
        setDestination(coords);
        setViewCenter(coords);
    }
  };

  const handleAddFloodZone = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!floodQuery) return;
    const zone = await searchAreaPolygon(floodQuery);
    if (zone) { setFloodZones(prev => [...prev, zone]); setFloodQuery(''); setFloodSuggestions([]); setViewCenter(zone.center); }
  };

  const handleSelectFloodZone = (suggestion: PlaceSuggestion) => {
      setFloodQuery(suggestion.display_name);
      setFloodSuggestions([]);
      setIsTypingFlood(false);
      searchAreaPolygon(suggestion.display_name).then(zone => { if (zone) { setFloodZones(prev => [...prev, zone]); setFloodQuery(''); setViewCenter(zone.center); }});
  };

  const abortNavigation = () => { stopSimulation(); setNavStatus(prev => ({ ...prev, isNavigating: false, alert: null, rerouting: false })); };

  // --- SYSTEM RESET WITH VISUAL FEEDBACK ---
  const handleReset = () => {
    if (window.confirm("CONFIRM REBOOT? This will clear all navigation data.")) {
        setIsResetting(true);
        speak("System reboot initiated.");
        // Simulate reboot delay then reload
        setTimeout(() => {
            window.location.reload();
        }, 2000);
    }
  };

  return (
    <div className="relative h-screen w-screen bg-[#020617] text-white overflow-hidden font-rajdhani flex flex-col md:block">
      
      {/* SYSTEM INIT / REBOOT OVERLAY */}
      {(!isSystemReady || isResetting) && (
          <div className="absolute inset-0 z-[100] bg-[#020617] flex flex-col items-center justify-center">
              <div className="relative mb-8">
                   <div className="w-24 h-24 border-4 border-cyan-500/30 rounded-full animate-[spin_3s_linear_infinite]"></div>
                   <div className="w-24 h-24 border-4 border-t-cyan-400 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-[spin_1.5s_linear_infinite] absolute inset-0"></div>
                   <Activity className="w-10 h-10 text-cyan-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
              </div>
              <div className="font-mono text-cyan-400 text-xl tracking-[0.2em] mb-2 font-bold">
                  {isResetting ? "SYSTEM REBOOT" : "HYDRONAV OS"}
              </div>
              <div className="flex flex-col items-center space-y-1">
                  {isResetting ? (
                      <div className="text-rose-500 animate-pulse tracking-widest text-sm font-bold">[!] CLEARING CACHE...</div>
                  ) : (
                      <>
                        <div className={`text-xs uppercase tracking-widest transition-colors ${initStep >= 0 ? 'text-cyan-400' : 'text-slate-700'}`}>[ OK ] Connecting GPS Satellites...</div>
                        <div className={`text-xs uppercase tracking-widest transition-colors ${initStep >= 1 ? 'text-cyan-400' : 'text-slate-700'}`}>[ OK ] Loading Flood Topography...</div>
                        <div className={`text-xs uppercase tracking-widest transition-colors ${initStep >= 2 ? 'text-cyan-400' : 'text-slate-700'}`}>[ OK ] System Calibrated</div>
                      </>
                  )}
              </div>
          </div>
      )}

      {/* 3D MAP LAYER */}
      <div className="absolute inset-0 z-0 bg-slate-900">
          <MapDisplay 
              id="main-map"
              center={viewCenter} 
              zoom={navStatus.isNavigating ? 18 : 16}
              userLocation={userLocation}
              destination={destination}
              route={route}
              floodZones={floodZones}
              interactive={!navStatus.isNavigating}
              isRisk={isBlocked}
              onMapClick={handleMapClick}
              activeTool={activeTool}
              tempHazardPoints={tempHazardPoints}
              is3DMode={navStatus.isNavigating}
              heading={navStatus.heading}
              pathTrail={pathTrail}
          />
      </div>

      {/* --- HUD HEADER (NAV MODE) --- */}
      {navStatus.isNavigating && (
          <div className="absolute top-4 left-0 w-full z-50 px-4 flex justify-center pointer-events-none">
              <div className="glass-panel w-full max-w-lg rounded-2xl p-4 flex items-center justify-between border-t border-cyan-500/50 shadow-[0_10px_40px_rgba(0,0,0,0.6)] animate-in slide-in-from-top-10 duration-700">
                  <div className="flex items-center space-x-4">
                      <div className="bg-cyan-500 p-3 rounded-xl shadow-[0_0_20px_rgba(6,182,212,0.6)]">
                          <CornerUpRight className="w-8 h-8 text-black" />
                      </div>
                      <div>
                          <div className="text-2xl font-bold text-white tracking-wide">Turn Right</div>
                          <div className="text-sm text-cyan-200 font-mono tracking-widest">IN 200 METERS</div>
                      </div>
                  </div>
                  <div className="text-right">
                      <div className="text-sm text-slate-400 font-bold uppercase">Then</div>
                      <div className="text-white font-bold opacity-60">Arrive</div>
                  </div>
              </div>
          </div>
      )}

      {/* --- STANDARD HEADER (NON-NAV MODE) --- */}
      {!navStatus.isNavigating && (
        <div className="absolute top-0 left-0 w-full p-2 md:p-4 z-40 pointer-events-none flex justify-between items-start">
            <div className="glass-panel px-3 py-2 md:px-4 md:py-2 rounded-full flex items-center space-x-2 md:space-x-3 pointer-events-auto shadow-lg">
                <div className="bg-cyan-500/20 p-1 md:p-1.5 rounded-full border border-cyan-400/50 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
                    <Navigation className="text-cyan-400 w-4 h-4 md:w-5 md:h-5" />
                </div>
                <div>
                    <h1 className="text-lg md:text-xl font-bold tracking-wider leading-none text-white">
                        HYDRONAV <span className="hidden md:inline text-cyan-400 text-xs align-top font-normal tracking-widest">OS v2.0</span>
                    </h1>
                </div>
            </div>
            {/* Status Pills & Controls */}
            <div className="flex items-center gap-3 pointer-events-auto">
                <button 
                    onClick={handleReset}
                    className="glass-panel p-2 md:p-2.5 rounded-full hover:bg-rose-500/20 hover:border-rose-500/50 transition-all group shadow-lg"
                    title="System Reset"
                >
                    <Power className="w-4 h-4 md:w-5 md:h-5 text-slate-400 group-hover:text-rose-400" />
                </button>
                <div className="glass-panel px-3 py-2 md:px-4 md:py-2 rounded-full flex items-center space-x-3 md:space-x-6 shadow-lg">
                    <div className={`flex items-center space-x-1.5 md:space-x-2 ${isLiveMonitoring ? 'animate-pulse' : 'opacity-50'}`}>
                        <Wifi className={`w-3 h-3 md:w-4 md:h-4 ${isLiveMonitoring ? 'text-red-500' : 'text-slate-500'}`} />
                        <span className="hidden md:block text-xs text-slate-300 font-mono tracking-widest">LIVE</span>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* --- BOTTOM HUD (NAV MODE) --- */}
      {navStatus.isNavigating && (
          <div className="absolute bottom-8 left-0 w-full px-6 z-50 flex items-end justify-between pointer-events-none">
              
              {/* Trip Info */}
              <div className="glass-panel p-4 rounded-2xl flex flex-col space-y-1 pointer-events-auto min-w-[140px]">
                   <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Arrival</div>
                   <div className="text-3xl font-bold text-white font-mono tracking-tighter">{navStatus.eta.split(' ')[0]}<span className="text-sm text-slate-400 ml-1">min</span></div>
                   <div className="flex space-x-3 text-sm font-mono text-cyan-400 pt-1 border-t border-white/10 mt-1">
                       <span>{formatDistance(navStatus.distanceRemaining)}</span>
                       <span className="text-slate-500">|</span>
                       <span className="text-white">12:45 PM</span>
                   </div>
                   <button onClick={abortNavigation} className="mt-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border border-rose-500/30 transition-colors">
                       End Trip
                   </button>
              </div>

              {/* Speedometer */}
              <div className="flex flex-col items-center">
                   <div className={`relative w-24 h-24 rounded-full border-4 ${getSpeedRingColor()} bg-black/40 backdrop-blur-xl flex items-center justify-center transition-all duration-300`}>
                        <div className="text-center">
                            <div className={`text-4xl font-black font-mono leading-none ${getSpeedColor()}`}>
                                {navStatus.currentSpeed}
                            </div>
                            <div className="text-[10px] text-slate-400 font-bold uppercase mt-1">KM/H</div>
                        </div>
                        {/* Limit Badge */}
                        <div className={`absolute -top-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center border-2 border-white bg-white text-black font-bold text-xs shadow-lg ${navStatus.currentSpeed > navStatus.speedLimit ? 'animate-bounce' : ''}`}>
                            {navStatus.speedLimit}
                        </div>
                   </div>
              </div>
          </div>
      )}

      {/* --- SIDEBAR & CONTROLS (NON-NAV MODE) --- */}
      {!navStatus.isNavigating && (
          <div className={`
            absolute z-40 transition-all duration-500 ease-in-out
            md:top-20 md:left-4 md:w-96 md:bottom-auto
            bottom-0 left-0 w-full
            flex flex-col space-y-4
            p-4 md:p-0
            ${sidebarOpen && window.innerWidth < 768 ? 'translate-y-[200px] opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'}
          `}>
             <div className="glass-panel rounded-t-2xl md:rounded-2xl p-4 shadow-2xl relative overflow-visible bg-[#020617]/90 md:bg-var(--glass-bg)">
                
                {/* CURRENT LOCATION HUD */}
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
                    <div className="flex items-center">
                        <div className="bg-cyan-500/10 p-1.5 rounded mr-3">
                             <Crosshair className="w-4 h-4 text-cyan-400" />
                        </div>
                        <div>
                            <div className="text-[10px] text-cyan-400 uppercase tracking-widest font-bold">Current Sector</div>
                            <div className="text-sm font-mono text-slate-300">
                                 {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
                            </div>
                        </div>
                    </div>
                    <button 
                        onClick={handleLocateMe}
                        className="p-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 transition-all active:scale-95 group"
                    >
                        {isLocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4 group-hover:scale-110 transition-transform" />}
                    </button>
                </div>

                {/* DESTINATION INPUT */}
                <div className="mb-4 relative z-50">
                    <label className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1 block">Set Target</label>
                    <div className="flex space-x-2">
                        <form onSubmit={handleDestinationSearch} className="relative flex-1">
                            <input 
                                type="text"
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); setIsTypingDest(true); }}
                                onFocus={() => setIsTypingDest(true)}
                                onBlur={() => setTimeout(() => setIsTypingDest(false), 200)}
                                placeholder="Where to?"
                                className="w-full bg-slate-900/50 border border-slate-700 rounded-lg py-2.5 pl-3 pr-10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:shadow-[0_0_15px_rgba(6,182,212,0.2)] transition-all font-mono"
                            />
                            <button type="submit" className="absolute right-2 top-2 p-1 text-slate-500 hover:text-cyan-400 transition-colors">
                                <Search className="w-4 h-4" />
                            </button>
                            {destSuggestions.length > 0 && isTypingDest && (
                                <ul className="absolute top-full mt-2 left-0 w-full glass-panel rounded-lg border border-slate-700 overflow-hidden z-[60] max-h-48 overflow-y-auto">
                                    {destSuggestions.map(item => (
                                        <li key={item.place_id} onMouseDown={() => handleSelectDestination(item)} className="px-4 py-2 hover:bg-cyan-500/20 hover:text-cyan-200 cursor-pointer text-xs truncate transition-colors border-b border-white/5 last:border-0">
                                            {item.display_name}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </form>
                        <button onClick={() => toggleTool('destination')} className={`px-3 rounded-lg border transition-all ${activeTool === 'destination' ? 'bg-cyan-500 text-black border-cyan-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}><MapPin className="w-4 h-4" /></button>
                    </div>
                </div>

                {/* HAZARD INPUT */}
                <div className="relative z-40">
                    <label className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1 block">Report Hazard</label>
                    <div className="flex space-x-2">
                         <form onSubmit={handleAddFloodZone} className="relative flex-1">
                             <input 
                                type="text" 
                                value={floodQuery} 
                                onChange={(e) => { setFloodQuery(e.target.value); setIsTypingFlood(true); }} 
                                onFocus={() => setIsTypingFlood(true)}
                                onBlur={() => setTimeout(() => setIsTypingFlood(false), 200)}
                                placeholder="Report Hazard..." 
                                className="w-full bg-slate-900/50 border border-slate-700 rounded-lg py-2.5 pl-3 pr-10 text-sm text-white focus:border-rose-500 transition-all font-mono focus:shadow-[0_0_15px_rgba(244,63,94,0.2)]" 
                             />
                             <button type="submit" className="absolute right-2 top-2 p-1 text-slate-500 hover:text-rose-400 transition-colors">
                                <ShieldAlert className="w-4 h-4" />
                             </button>
                             {floodSuggestions.length > 0 && isTypingFlood && (
                                <ul className="absolute top-full mt-2 left-0 w-full glass-panel rounded-lg border border-slate-700 overflow-hidden z-[60] max-h-48 overflow-y-auto">
                                    {floodSuggestions.map(item => (
                                        <li key={item.place_id} onMouseDown={() => handleSelectFloodZone(item)} className="px-4 py-2 hover:bg-rose-500/20 hover:text-rose-200 cursor-pointer text-xs truncate transition-colors border-b border-white/5 last:border-0">
                                            {item.display_name}
                                        </li>
                                    ))}
                                </ul>
                            )}
                         </form>
                         <button 
                            onClick={() => toggleTool('hazard')}
                            className={`px-3 rounded-lg border transition-all ${activeTool === 'hazard' ? 'bg-rose-500 text-white border-rose-400 shadow-[0_0_10px_#f43f5e]' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
                        >
                            <PenTool className="w-4 h-4" />
                        </button>
                    </div>
                </div>
             </div>

             {/* START CARD */}
             {route && !isCalculating && (
                 <div className="glass-panel rounded-2xl p-4 shadow-2xl animate-in slide-in-from-left-4 fade-in duration-500 bg-[#020617]/90 md:bg-var(--glass-bg)">
                    {isBlocked ? (
                        <div className="space-y-3">
                             <div className="flex items-center text-rose-400 text-xs font-bold uppercase tracking-widest"><AlertTriangle className="w-4 h-4 mr-2" /> Hazard Detected</div>
                             <div className="text-slate-300 text-xs leading-relaxed">
                                Detected hazard interception. Direct path unsafe.
                             </div>
                             <button onClick={() => calculateRoute(userLocation, destination!, floodZones, true, true)} className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold py-3 rounded-xl flex items-center justify-center space-x-2 transition-all shadow-lg shadow-amber-900/40"><RefreshCw className="w-4 h-4" /><span>COMPUTE DETOUR</span></button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                             <div className="flex items-center justify-between">
                                <span className="text-emerald-400 text-xs font-bold uppercase tracking-widest flex items-center"><Check className="w-3 h-3 mr-1" /> Path Clear</span>
                                <span className="text-slate-400 text-xs font-mono">{formatDuration(route.totalDuration)} / {formatDistance(route.totalDistance)}</span>
                             </div>
                             <div className="flex space-x-2">
                                <button onClick={startRealNavigation} className="flex-1 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold py-3 rounded-xl shadow-[0_0_15px_rgba(6,182,212,0.4)] flex items-center justify-center space-x-2 transition-all transform hover:scale-[1.02]">
                                    <Play className="w-5 h-5 fill-current" /> <span>START NAV</span>
                                </button>
                                <button onClick={startSimulation} title="Run Demo Simulation" className="px-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-400 hover:text-white transition-colors">
                                    <Clock className="w-5 h-5" />
                                </button>
                             </div>
                        </div>
                    )}
                 </div>
             )}
          </div>
      )}

      {/* SUMMARY MODAL */}
      {showSummary && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md">
              <div className="glass-panel p-8 rounded-3xl text-center max-w-sm w-full animate-in zoom-in-95 duration-500 border-cyan-500/30 shadow-[0_0_50px_rgba(6,182,212,0.2)]">
                  <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.4)]">
                      <Flag className="w-10 h-10 text-emerald-400" />
                  </div>
                  <h2 className="text-3xl font-bold text-white mb-2">Destination Reached</h2>
                  <p className="text-slate-400 mb-8">Route completed successfully.</p>
                  <div className="grid grid-cols-2 gap-4 mb-8">
                      <div className="bg-slate-800/50 p-4 rounded-xl">
                          <div className="text-xs text-slate-500 uppercase tracking-widest">Time</div>
                          <div className="text-xl font-mono text-white">{tripStats.duration}</div>
                      </div>
                      <div className="bg-slate-800/50 p-4 rounded-xl">
                          <div className="text-xs text-slate-500 uppercase tracking-widest">Avg Speed</div>
                          <div className="text-xl font-mono text-white">{tripStats.avgSpeed} km/h</div>
                      </div>
                  </div>
                  <button onClick={() => { setShowSummary(false); setRoute(null); setDestination(null); }} className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-bold text-white transition-colors">
                      Done
                  </button>
              </div>
          </div>
      )}

      {/* Live Monitor Toggle */}
      {!navStatus.isNavigating && (
          <div className="absolute top-20 right-4 z-40 hidden md:block">
              <div className="glass-panel p-2 rounded-lg" title="Toggle Live Simulation">
                   <button 
                        onClick={() => setIsLiveMonitoring(!isLiveMonitoring)}
                        className={`p-2 rounded-md transition-colors ${isLiveMonitoring ? 'text-cyan-400 bg-cyan-900/30' : 'text-slate-500 hover:text-white'}`}
                    >
                        <Wifi className="w-5 h-5" />
                    </button>
              </div>
          </div>
      )}
      
      {/* DRAWING MODE INDICATOR */}
      {activeTool !== 'none' && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 glass-panel px-4 py-2 md:px-6 md:py-2 rounded-full flex items-center space-x-3 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.3)] whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              <span className="text-xs md:text-sm font-bold text-amber-100 uppercase tracking-wider">
                  {activeTool === 'destination' ? 'Tap Map to Target' : 'Plot Hazard'}
              </span>
              {activeTool === 'hazard' && tempHazardPoints.length > 0 && (
                  <button onClick={confirmHazardDrawing} className="ml-2 bg-amber-500 text-black px-2 py-0.5 rounded text-xs font-bold hover:bg-amber-400">CONFIRM</button>
              )}
              <button onClick={() => { setActiveTool('none'); setTempHazardPoints([]); }} className="ml-2 hover:text-white text-slate-400"><X className="w-4 h-4"/></button>
          </div>
      )}

    </div>
  );
};

export default App;