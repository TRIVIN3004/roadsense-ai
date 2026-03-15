import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  Map as MapIcon, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  User, 
  LogOut, 
  Shield, 
  Navigation,
  RefreshCw,
  Plus,
  X,
  ChevronRight,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  Timestamp,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  AreaChart,
  Area
} from 'recharts';
import { auth, db } from './firebase';
import { detectRoadDamage, DetectionResult } from './services/ai';
import { cn } from './lib/utils';

// --- Types ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface Report {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  location: { lat: number; lng: number };
  imageUrl: string;
  timestamp: any;
  status: 'reported' | 'assigned' | 'repaired';
  reportedBy: string;
}

interface UserProfile {
  role: 'authority' | 'citizen';
  email: string;
}

// --- Components ---

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error) errorMessage = `System Error: ${parsed.error}`;
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6 text-center">
          <div className="max-w-md space-y-6">
            <div className="w-20 h-20 bg-red-100 text-red-600 rounded-3xl flex items-center justify-center mx-auto">
              <AlertTriangle className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-black text-stone-900">Application Error</h2>
            <p className="text-stone-500 text-sm leading-relaxed">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="bg-stone-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-stone-800 transition-all"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const SeverityBadge = ({ severity }: { severity: string }) => {
  const colors = {
    low: "bg-blue-100 text-blue-700 border-blue-200",
    medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
    high: "bg-red-100 text-red-700 border-red-200",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium border capitalize", colors[severity as keyof typeof colors])}>
      {severity}
    </span>
  );
};

const StatusIcon = ({ status }: { status: string }) => {
  switch (status) {
    case 'reported': return <Clock className="w-4 h-4 text-gray-400" />;
    case 'assigned': return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin-slow" />;
    case 'repaired': return <CheckCircle className="w-4 h-4 text-green-500" />;
    default: return null;
  }
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [view, setView] = useState<'dashboard' | 'capture' | 'map' | 'analytics' | 'mission'>('dashboard');
  const [loading, setLoading] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [activeAlert, setActiveAlert] = useState<Report | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- Auth & Data ---

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const path = `users/${u.uid}`;
        try {
          const userDoc = await getDoc(doc(db, 'users', u.uid));
          if (userDoc.exists()) {
            setProfile(userDoc.data() as UserProfile);
          } else {
            const newProfile: UserProfile = { role: 'citizen', email: u.email || '' };
            await setDoc(doc(db, 'users', u.uid), newProfile);
            setProfile(newProfile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, path);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;
    const path = 'reports';
    const q = query(collection(db, path), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Report));
      
      // Real-time Alert Logic: If a new high-severity report comes in
      setReports(prev => {
        if (data.length > prev.length) {
          const latest = data[0];
          if (latest && latest.severity === 'high' && latest.status === 'reported') {
            setActiveAlert(latest);
            setTimeout(() => setActiveAlert(null), 5000);
          }
        }
        return data;
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });
    return unsubscribe;
  }, [user]);

  // --- Analytics Data ---

  const severityData = [
    { name: 'High', value: reports.filter(r => r.severity === 'high').length, color: '#ef4444' },
    { name: 'Medium', value: reports.filter(r => r.severity === 'medium').length, color: '#f59e0b' },
    { name: 'Low', value: reports.filter(r => r.severity === 'low').length, color: '#3b82f6' },
  ];

  const typeData = Array.from(new Set(reports.map(r => r.type))).map(type => ({
    name: type,
    count: reports.filter(r => r.type === type).length
  })).sort((a, b) => b.count - a.count).slice(0, 5);

  // --- Actions ---

  const login = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error: any) {
      if (error.code === 'auth/cancelled-popup-request' || error.code === 'auth/popup-closed-by-user') {
        console.log('Login popup closed or cancelled');
      } else {
        console.error('Login error:', error);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = () => signOut(auth);

  const startCamera = async () => {
    setIsCapturing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      // Get location
      navigator.geolocation.getCurrentPosition((pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      });
    } catch (err) {
      console.error("Camera error", err);
      setIsCapturing(false);
    }
  };

  const captureAndDetect = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    
    const base64 = canvas.toDataURL('image/jpeg');
    setCapturedImage(base64);
    
    // Stop camera
    const stream = video.srcObject as MediaStream;
    stream.getTracks().forEach(t => t.stop());
    
    setLoading(true);
    const result = await detectRoadDamage(base64);
    setDetection(result);
    setLoading(false);
  };

  const submitReport = async () => {
    if (!user || (!detection && !location && !capturedImage)) return; // Ensure at least user is defined, but we'll provide defaults
    
    const path = 'reports';
    try {
      const type = detection?.type || "pothole";
      const severity = detection?.severity || "low";
      const imageUrl = capturedImage || "";
      
      const lat = Number(location?.lat) || 0;
      const lng = Number(location?.lng) || 0;

      const payload = {
        type: type,
        severity: severity,
        location: { lat, lng },
        imageUrl: imageUrl,
        timestamp: serverTimestamp(),
        status: 'reported',
        reportedBy: user.uid
      };
      
      const cleanPayload = Object.fromEntries(
        Object.entries(payload).filter(([_, value]) => value !== undefined)
      );

      await addDoc(collection(db, path), cleanPayload);
      resetCapture();
      setView('dashboard');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const resetCapture = () => {
    setIsCapturing(false);
    setDetection(null);
    setCapturedImage(null);
    setLoading(false);
  };

  const updateStatus = async (reportId: string, newStatus: string) => {
    if (profile?.role !== 'authority') return;
    const path = `reports/${reportId}`;
    try {
      await updateDoc(doc(db, 'reports', reportId), { status: newStatus });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  // --- UI Components ---

  const GpsStatus = () => (
    <div className="absolute top-4 left-4 z-50 flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/20">
      <div className={cn("w-2 h-2 rounded-full animate-pulse", location ? "bg-emerald-500" : "bg-amber-500")} />
      <span className="text-[10px] font-mono text-white uppercase tracking-wider">
        {location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : "Acquiring GPS..."}
      </span>
    </div>
  );

  const DetectionHUD = () => (
    <div className="absolute inset-0 pointer-events-none border-[20px] border-transparent">
      {/* Corner Brackets */}
      <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-white/30" />
      <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-white/30" />
      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-white/30" />
      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-white/30" />
      
      {detection && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-2 border-dashed border-red-500/50 rounded-lg flex items-center justify-center"
        >
          <div className="bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded absolute -top-3 uppercase tracking-tighter">
            {detection.type} Detected ({detection.severity})
          </div>
        </motion.div>
      )}
    </div>
  );

  if (loading && !isCapturing) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-10 h-10 text-emerald-600 animate-spin" />
          <p className="text-stone-400 font-medium animate-pulse">Initializing RoadSense...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6 text-center">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-24 h-24 bg-emerald-600 rounded-[2.5rem] flex items-center justify-center mb-8 shadow-2xl shadow-emerald-600/20 rotate-12"
        >
          <Navigation className="w-12 h-12 text-white -rotate-12" />
        </motion.div>
        <h1 className="text-5xl font-black tracking-tighter text-stone-900 mb-3">RoadSense AI</h1>
        <p className="text-stone-500 max-w-xs mb-10 leading-relaxed">
          The intelligent infrastructure layer for modern cities. Detect, report, and track road maintenance in real-time.
        </p>
        <button 
          onClick={login}
          disabled={isLoggingIn}
          className="group relative bg-stone-900 text-white px-10 py-5 rounded-2xl font-bold flex items-center gap-3 hover:bg-stone-800 transition-all active:scale-95 shadow-2xl shadow-stone-900/20 overflow-hidden disabled:opacity-70 disabled:cursor-not-allowed"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          {isLoggingIn ? (
            <RefreshCw className="w-6 h-6 animate-spin" />
          ) : (
            <User className="w-6 h-6" />
          )}
          {isLoggingIn ? 'Connecting...' : 'Get Started'}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-900 pb-28">
      {/* Real-time Alert Notification */}
      <AnimatePresence>
        {activeAlert && (
          <motion.div 
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 20, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-6"
          >
            <div className="bg-red-600 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-4 border border-red-500">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-black uppercase tracking-widest opacity-80">Critical Alert</p>
                <p className="font-bold">New {activeAlert.type} detected!</p>
              </div>
              <button onClick={() => setActiveAlert(null)} className="p-2 hover:bg-white/10 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white/70 backdrop-blur-xl sticky top-0 z-40 border-b border-stone-200/60 px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-stone-900 rounded-xl flex items-center justify-center shadow-lg shadow-stone-900/10">
            <Navigation className="w-6 h-6 text-white" />
          </div>
          <div>
            <span className="font-black text-xl tracking-tighter block leading-none">RoadSense</span>
            <div className="flex items-center gap-1.5 mt-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">System Live</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {profile?.role === 'authority' && (
            <div className="bg-amber-50 text-amber-600 text-[9px] uppercase font-black tracking-[0.2em] px-3 py-1.5 rounded-full border border-amber-100 shadow-sm">
              Admin Mode
            </div>
          )}
          <button onClick={logout} className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center text-stone-500 hover:bg-stone-200 hover:text-stone-900 transition-all">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-6">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="text-3xl font-black tracking-tight">Activity</h2>
                  <p className="text-stone-400 text-sm font-medium">Monitoring {reports.length} locations</p>
                </div>
                <div className="bg-white px-4 py-2 rounded-2xl border border-stone-200 shadow-sm flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-bold text-stone-600">Verified Data</span>
                </div>
              </div>

              {reports.length === 0 ? (
                <div className="bg-white border border-stone-200 rounded-[2.5rem] p-16 text-center space-y-6 shadow-sm">
                  <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mx-auto border border-stone-100">
                    <Camera className="w-10 h-10 text-stone-200" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xl font-bold text-stone-900">No reports found</p>
                    <p className="text-stone-400 text-sm max-w-[200px] mx-auto">Start scanning the road to generate your first AI report.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {reports.map((report) => (
                    <motion.div 
                      layoutId={report.id}
                      key={report.id}
                      className="bg-white border border-stone-200 rounded-[2rem] p-5 flex gap-5 hover:shadow-xl hover:shadow-stone-200/50 transition-all cursor-pointer group relative overflow-hidden"
                    >
                      <div className="relative w-28 h-28 shrink-0">
                        <img 
                          src={report.imageUrl} 
                          className="w-full h-full rounded-2xl object-cover bg-stone-100 shadow-inner" 
                          alt="Damage"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute top-2 left-2">
                          <StatusIcon status={report.status} />
                        </div>
                      </div>
                      <div className="flex-1 space-y-2 py-1">
                        <div className="flex items-center justify-between">
                          <h3 className="font-black text-lg text-stone-900 tracking-tight">{report.type}</h3>
                          <span className="text-[10px] text-stone-300 font-black uppercase tracking-widest">
                            #{report.id.slice(-4)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <SeverityBadge severity={report.severity} />
                          <div className="flex items-center gap-1 text-stone-400">
                            <Clock className="w-3 h-3" />
                            <span className="text-[10px] font-bold uppercase tracking-wider">
                              {report.timestamp?.toDate().toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-stone-500">
                          <MapIcon className="w-3.5 h-3.5" />
                          <p className="text-[11px] font-medium font-mono">
                            {report.location.lat.toFixed(5)}, {report.location.lng.toFixed(5)}
                          </p>
                        </div>
                        
                        {profile?.role === 'authority' && report.status !== 'repaired' && (
                          <div className="pt-3">
                            <button 
                              onClick={(e) => { e.stopPropagation(); updateStatus(report.id, report.status === 'reported' ? 'assigned' : 'repaired'); }}
                              className="w-full py-2.5 rounded-xl bg-stone-900 text-white text-[10px] font-black uppercase tracking-[0.15em] hover:bg-emerald-600 transition-all shadow-lg shadow-stone-900/10"
                            >
                              {report.status === 'reported' ? 'Dispatch Crew' : 'Complete Repair'}
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {view === 'map' && (
            <motion.div 
              key="map"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-8"
            >
              <div>
                <h2 className="text-3xl font-black tracking-tight">Geospatial</h2>
                <p className="text-stone-400 text-sm font-medium">Real-time damage clustering</p>
              </div>

              <div className="bg-stone-950 rounded-[3rem] aspect-square relative overflow-hidden shadow-2xl border-8 border-white">
                {/* Simulated Map Grid */}
                <div className="absolute inset-0 grid grid-cols-12 grid-rows-12 opacity-10">
                  {Array.from({ length: 144 }).map((_, i) => (
                    <div key={i} className="border-[0.5px] border-emerald-500" />
                  ))}
                </div>
                
                {/* Radar Scan Effect */}
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 bg-gradient-to-tr from-emerald-500/5 to-transparent origin-center"
                />

                {reports.map((r) => (
                  <motion.div 
                    key={r.id}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
                    style={{ 
                      left: `${((r.location.lng + 180) % 1) * 100}%`, 
                      top: `${((r.location.lat + 90) % 1) * 100}%` 
                    }}
                  >
                    <div className={cn(
                      "absolute inset-0 rounded-full animate-ping opacity-20",
                      r.severity === 'high' ? 'bg-red-500' : r.severity === 'medium' ? 'bg-amber-500' : 'bg-blue-500'
                    )} />
                    <div className={cn(
                      "w-3 h-3 rounded-full shadow-[0_0_15px_rgba(0,0,0,0.5)] border-2 border-white",
                      r.severity === 'high' ? 'bg-red-500' : r.severity === 'medium' ? 'bg-amber-500' : 'bg-blue-500'
                    )} />
                  </motion.div>
                ))}

                <div className="absolute top-6 right-6 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-black text-white uppercase tracking-widest">Live Feed</span>
                </div>

                <div className="absolute bottom-8 left-8 right-8 bg-white/10 backdrop-blur-xl p-6 rounded-[2rem] border border-white/20 text-white">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs font-black uppercase tracking-widest opacity-80">Infrastructure Health</p>
                    <Shield className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="flex gap-6">
                    <div>
                      <div className="text-2xl font-black">{reports.length}</div>
                      <div className="text-[9px] font-bold uppercase opacity-50 tracking-wider">Total Points</div>
                    </div>
                    <div className="w-px h-8 bg-white/10" />
                    <div>
                      <div className="text-2xl font-black text-red-400">{reports.filter(r => r.severity === 'high').length}</div>
                      <div className="text-[9px] font-bold uppercase opacity-50 tracking-wider">Critical</div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'analytics' && (
            <motion.div 
              key="analytics"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-black tracking-tight">Intelligence</h2>
                  <p className="text-stone-400 text-sm font-medium">Infrastructure health analytics</p>
                </div>
                <div className="flex gap-2">
                  <div className="bg-white p-3 rounded-2xl border border-stone-200 shadow-sm text-center">
                    <div className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Uptime</div>
                    <div className="text-lg font-black text-emerald-600">99.9%</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Severity Distribution */}
                <div className="bg-white p-8 rounded-[2.5rem] border border-stone-200 shadow-sm">
                  <h3 className="text-lg font-black mb-6 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-emerald-600" />
                    Severity Mix
                  </h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={severityData}
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {severityData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-center gap-6 mt-4">
                    {severityData.map(s => (
                      <div key={s.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-xs font-bold text-stone-500">{s.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top Damage Types */}
                <div className="bg-white p-8 rounded-[2.5rem] border border-stone-200 shadow-sm">
                  <h3 className="text-lg font-black mb-6 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    Top Anomalies
                  </h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={typeData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                        <XAxis type="number" hide />
                        <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                        <RechartsTooltip 
                          cursor={{ fill: '#f9fafb' }}
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        />
                        <Bar dataKey="count" fill="#1c1917" radius={[0, 10, 10, 0]} barSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Hotspot Trend */}
                <div className="bg-white p-8 rounded-[2.5rem] border border-stone-200 shadow-sm md:col-span-2">
                  <h3 className="text-lg font-black mb-6 flex items-center gap-2">
                    <RefreshCw className="w-5 h-5 text-blue-500" />
                    Detection Velocity
                  </h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={reports.slice(0, 7).reverse().map((r, i) => ({ name: `Day ${i+1}`, value: Math.floor(Math.random() * 10) + 5 }))}>
                        <defs>
                          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="name" tick={{ fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                        <RechartsTooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        />
                        <Area type="monotone" dataKey="value" stroke="#10b981" fillOpacity={1} fill="url(#colorValue)" strokeWidth={3} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
          {view === 'mission' && (
            <motion.div 
              key="mission"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12 pb-12"
            >
              <section className="space-y-4">
                <h2 className="text-5xl font-black tracking-tighter leading-[0.9]">The Future of <br/><span className="text-emerald-600">Infrastructure.</span></h2>
                <p className="text-stone-500 font-medium text-lg leading-relaxed">
                  RoadSense AI is building the intelligent nervous system for modern cities.
                </p>
              </section>

              <div className="grid gap-8">
                <div className="bg-white p-8 rounded-[2.5rem] border border-stone-200 shadow-sm space-y-4">
                  <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-black tracking-tight">The Problem</h3>
                  <p className="text-stone-500 text-sm leading-relaxed">
                    Traditional road maintenance is reactive. Cities wait for complaints while potholes cause $3B+ in annual vehicle damage and thousands of accidents.
                  </p>
                </div>

                <div className="bg-stone-900 p-8 rounded-[2.5rem] text-white space-y-4 shadow-2xl shadow-stone-900/20">
                  <div className="w-12 h-12 bg-emerald-500 text-white rounded-2xl flex items-center justify-center">
                    <Shield className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-black tracking-tight">The Solution</h3>
                  <p className="text-stone-300 text-sm leading-relaxed">
                    A proactive, AI-driven monitoring layer. We turn every vehicle into a high-precision inspector, automating detection and dispatch in real-time.
                  </p>
                </div>

                <div className="bg-white p-8 rounded-[2.5rem] border border-stone-200 shadow-sm space-y-4">
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                    <RefreshCw className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-black tracking-tight">The Technology</h3>
                  <p className="text-stone-500 text-sm leading-relaxed">
                    Our Vision Engine uses deep learning to identify 12+ types of road damage at 30fps, paired with sub-meter GPS telemetry for instant reporting.
                  </p>
                </div>
              </div>

              <div className="bg-emerald-50 p-10 rounded-[3rem] border border-emerald-100 text-center space-y-4">
                <h3 className="text-2xl font-black text-emerald-900 tracking-tight">Impact on Safety</h3>
                <p className="text-emerald-700 text-sm font-medium leading-relaxed">
                  By reducing time-to-repair from weeks to hours, we prevent swerving maneuvers and high-speed collisions, saving lives through data.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Capture Overlay */}
      <AnimatePresence>
        {isCapturing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black flex flex-col"
          >
            <GpsStatus />
            
            {!capturedImage ? (
              <>
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  className="flex-1 object-cover"
                />
                <DetectionHUD />
                
                <div className="absolute bottom-16 left-0 right-0 flex items-center justify-center gap-10">
                  <button 
                    onClick={resetCapture}
                    className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-xl flex items-center justify-center text-white border border-white/10 hover:bg-white/20 transition-all"
                  >
                    <X className="w-7 h-7" />
                  </button>
                  <button 
                    onClick={captureAndDetect}
                    className="w-24 h-24 rounded-full border-4 border-white flex items-center justify-center p-1.5 shadow-2xl shadow-white/20 active:scale-90 transition-transform"
                  >
                    <div className="w-full h-full bg-white rounded-full flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full border-2 border-stone-200" />
                    </div>
                  </button>
                  <div className="w-14 h-14" />
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col bg-stone-950">
                <div className="flex-1 relative rounded-b-[3rem] overflow-hidden shadow-2xl">
                  <img src={capturedImage} className="w-full h-full object-cover" alt="Captured" />
                  {loading && (
                    <div className="absolute inset-0 bg-stone-950/80 backdrop-blur-md flex flex-col items-center justify-center text-white space-y-6">
                      <div className="relative">
                        <RefreshCw className="w-16 h-16 animate-spin text-emerald-500 opacity-20" />
                        <Shield className="w-8 h-8 text-emerald-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                      </div>
                      <div className="text-center space-y-2">
                        <p className="text-xl font-black tracking-tight">AI Analysis</p>
                        <p className="text-xs font-bold text-emerald-500/60 uppercase tracking-widest animate-pulse">Scanning Surface Topology</p>
                      </div>
                    </div>
                  )}
                </div>

                <AnimatePresence>
                  {detection && (
                    <motion.div 
                      initial={{ y: "100%" }}
                      animate={{ y: 0 }}
                      className="bg-white rounded-t-[3rem] p-8 space-y-8 shadow-2xl -mt-12 relative z-10"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em]">Detection Alert</p>
                          <h3 className="text-3xl font-black text-stone-900 tracking-tight capitalize">{detection.type}</h3>
                        </div>
                        <SeverityBadge severity={detection.severity} />
                      </div>

                      <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100 flex items-center gap-4">
                        <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
                          <Navigation className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest">GPS Location Captured</p>
                          <p className="text-sm font-mono font-bold text-stone-600">
                            {location?.lat.toFixed(6)}, {location?.lng.toFixed(6)}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <button 
                          onClick={resetCapture}
                          className="py-5 rounded-2xl border-2 border-stone-100 font-black text-xs uppercase tracking-widest text-stone-400 hover:bg-stone-50 transition-all"
                        >
                          Discard
                        </button>
                        <button 
                          onClick={submitReport}
                          className="bg-stone-900 text-white py-5 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-stone-900/20 hover:bg-stone-800 active:scale-95 transition-all flex items-center justify-center gap-2"
                        >
                          <AlertTriangle className="w-5 h-5" />
                          Report Damage
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Nav */}
      <div className="fixed bottom-8 left-8 right-8 z-40">
        <nav className="bg-white/80 backdrop-blur-xl border border-stone-200/60 rounded-[2.5rem] shadow-2xl flex items-center justify-around p-2.5">
          <button 
            onClick={() => setView('dashboard')}
            className={cn(
              "flex-1 flex flex-col items-center py-3 rounded-2xl transition-all relative",
              view === 'dashboard' ? "text-stone-900 bg-stone-50" : "text-stone-300 hover:text-stone-500"
            )}
          >
            <Clock className="w-6 h-6" />
            <span className="text-[9px] font-black uppercase tracking-widest mt-1.5">Feed</span>
            {view === 'dashboard' && <motion.div layoutId="nav-dot" className="absolute -bottom-1 w-1 h-1 bg-stone-900 rounded-full" />}
          </button>
          
          <button 
            onClick={() => setView('map')}
            className={cn(
              "flex-1 flex flex-col items-center py-3 rounded-2xl transition-all relative",
              view === 'map' ? "text-stone-900 bg-stone-50" : "text-stone-300 hover:text-stone-500"
            )}
          >
            <MapIcon className="w-6 h-6" />
            <span className="text-[9px] font-black uppercase tracking-widest mt-1.5">Map</span>
            {view === 'map' && <motion.div layoutId="nav-dot" className="absolute -bottom-1 w-1 h-1 bg-stone-900 rounded-full" />}
          </button>

          <button 
            onClick={startCamera}
            className="w-16 h-16 bg-stone-900 text-white rounded-[1.5rem] flex items-center justify-center shadow-2xl shadow-stone-900/40 -translate-y-6 active:scale-90 transition-all group"
          >
            <Plus className="w-9 h-9 group-hover:rotate-90 transition-transform duration-300" />
          </button>

          <button 
            onClick={() => setView('analytics')}
            className={cn(
              "flex-1 flex flex-col items-center py-3 rounded-2xl transition-all relative",
              view === 'analytics' ? "text-stone-900 bg-stone-50" : "text-stone-300 hover:text-stone-500"
            )}
          >
            <Shield className="w-6 h-6" />
            <span className="text-[9px] font-black uppercase tracking-widest mt-1.5">Intel</span>
            {view === 'analytics' && <motion.div layoutId="nav-dot" className="absolute -bottom-1 w-1 h-1 bg-stone-900 rounded-full" />}
          </button>

          <button 
            onClick={() => setView('mission')}
            className={cn(
              "flex-1 flex flex-col items-center py-3 rounded-2xl transition-all relative",
              view === 'mission' ? "text-stone-900 bg-stone-50" : "text-stone-300 hover:text-stone-500"
            )}
          >
            <User className="w-6 h-6" />
            <span className="text-[9px] font-black uppercase tracking-widest mt-1.5">Mission</span>
            {view === 'mission' && <motion.div layoutId="nav-dot" className="absolute -bottom-1 w-1 h-1 bg-stone-900 rounded-full" />}
          </button>
        </nav>
      </div>
    </div>
  );
}
