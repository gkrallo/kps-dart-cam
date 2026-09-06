import { useState, useRef, useCallback, useEffect } from 'react';
import { Loader2, Camera, Eye, Target } from 'lucide-react';
import { CameraFeed } from './components/CameraFeed';
import { useOpenCV } from './hooks/useOpenCV';
import { CalibrationOverlay } from './components/CalibrationOverlay';
import { Point } from './types';
import { useDartDetector } from './hooks/useDartDetector';
import { useDartGame } from './hooks/useDartGame';
import { getScoreFromCoordinates } from './utils/dartMath';
import { Scoreboard } from './components/Scoreboard';

export default function App() {
  const { isLoaded, isLoading, error, cv } = useOpenCV();
  
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [detectorState, setDetectorState] = useState<string>('INACTIVE');
  const [noiseLevel, setNoiseLevel] = useState<number>(0);
  const [motionThreshold, setMotionThreshold] = useState<number>(3000);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [lastScoredDartLabel, setLastScoredDartLabel] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'live' | 'vision'>('live');

  // 501 Game Motor Hook
  const {
    currentScore,
    currentTurnDarts,
    isBust,
    isWon,
    registerDart,
    undoLastDart,
    resetGame,
  } = useDartGame(501);
  
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const transformMatrixRef = useRef<any>(null); // To store cv.Mat

  // Cleanup transform matrix on unmount
  useEffect(() => {
    return () => {
      if (transformMatrixRef.current) {
        transformMatrixRef.current.delete();
      }
    };
  }, []);

  const handleVideoReady = useCallback((video: HTMLVideoElement) => {
    console.log('Video är redo:', video.videoWidth, 'x', video.videoHeight);
    setVideoElement(video);
  }, []);

  const handleContainerResize = useCallback((width: number, height: number) => {
    setContainerSize({ width, height });
  }, []);

  const handlePointsChange = useCallback((points: Point[]) => {
    setCalibrationPoints(points);
  }, []);

  const handleDartDetected = useCallback((pt: Point) => {
    const scoreObj = getScoreFromCoordinates(pt.x, pt.y);
    console.log('Dart detected at:', pt, 'Score:', scoreObj);
    
    // Register dart in 501 game motor
    registerDart(scoreObj);
    
    // Show toast / label indicator for 2 seconds
    setLastScoredDartLabel(scoreObj.label);
    setTimeout(() => {
      setLastScoredDartLabel(null);
    }, 2500);
  }, [registerDart]);

  const handleDebugState = useCallback((state: string, noise: number) => {
    setDetectorState(state);
    setNoiseLevel(noise);
  }, []);

  // Use our detection hook
  useDartDetector(cv, videoElement, transformMatrixRef.current, isCalibrated, motionThreshold, debugCanvasRef, handleDartDetected, handleDebugState);

  const handleCalibrationClick = () => {
    if (isCalibrated) {
      if (transformMatrixRef.current) {
        transformMatrixRef.current.delete();
        transformMatrixRef.current = null;
      }
      setIsCalibrated(false);
      resetGame();
      return;
    }
    
    if (!cv || !videoElement) {
      console.warn("Kamera eller OpenCV inte redo för kalibrering ännu.");
      return;
    }

    if (calibrationPoints.length !== 4) {
      console.warn("4 kalibreringspunkter krävs, fick:", calibrationPoints.length);
      return;
    }
    
    try {
      // 1. Transform screen display points to raw video frame coordinates
      const vw = videoElement.videoWidth || 1280;
      const vh = videoElement.videoHeight || 720;
      const cw = containerSize.width || window.innerWidth;
      const ch = containerSize.height || window.innerHeight;
      const cx = cw / 2;
      const cy = ch / 2;
      
      const scale = Math.max(cw / vw, ch / vh);
      const videoDisplayWidth = vw * scale;
      const videoDisplayHeight = vh * scale;
      const offsetX = (videoDisplayWidth - cw) / 2;
      const offsetY = (videoDisplayHeight - ch) / 2;
      
      const videoPoints = calibrationPoints.map(p => {
        // Unzoom screen coordinates relative to container center
        const unzoomedX = (p.x - cx) / zoomLevel + cx;
        const unzoomedY = (p.y - cy) / zoomLevel + cy;
        return {
          x: (unzoomedX + offsetX) / scale,
          y: (unzoomedY + offsetY) / scale
        };
      });
      
      // 2. Create source and destination Mats
      const srcCoords = [
        videoPoints[0].x, videoPoints[0].y, // Top
        videoPoints[1].x, videoPoints[1].y, // Right
        videoPoints[2].x, videoPoints[2].y, // Bottom
        videoPoints[3].x, videoPoints[3].y  // Left
      ];
      const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, srcCoords);
      
      const targetSize = 800; // Size of the debug canvas
      const dstCoords = [
        targetSize/2, 0,             // Top
        targetSize,   targetSize/2,  // Right
        targetSize/2, targetSize,    // Bottom
        0,            targetSize/2   // Left
      ];
      const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, dstCoords);
      
      // 3. Get transformation matrix
      const matrix = cv.getPerspectiveTransform(srcMat, dstMat);
      
      // Save the matrix in ref for the hook to use
      if (transformMatrixRef.current) {
        transformMatrixRef.current.delete();
      }
      transformMatrixRef.current = matrix;

      // Cleanup
      srcMat.delete();
      dstMat.delete();
      
      setIsCalibrated(true);
    } catch (err) {
      console.error("Kalibrering misslyckades:", err);
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-slate-950 text-slate-50 overflow-hidden font-sans">
      {/* Header */}
      <header className="absolute top-0 w-full z-20 p-3 sm:p-4 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex justify-between items-center pointer-events-none">
        <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white drop-shadow-md">KPs DartApp 501</h1>

        {/* View Mode Switcher (Live vs Vision 2D View) */}
        {isCalibrated && (
          <div className="pointer-events-auto bg-slate-950/90 border border-slate-800 p-1 rounded-2xl shadow-2xl backdrop-blur-md flex items-center gap-1">
            <button
              onClick={() => setViewMode('live')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'live'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Live View</span>
            </button>
            <button
              onClick={() => setViewMode('vision')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'vision'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-emerald-300" />
              <span>Vision View</span>
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
           {isLoaded ? (
              <span className="flex h-3 w-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]" title="OpenCV Datorseende Aktivt"></span>
           ) : (
              <span className="flex h-3 w-3 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]" title="Laddar OpenCV..."></span>
           )}
        </div>
      </header>

      {/* Main Viewport Container */}
      <main className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
        {/* Camera Feed (Always active in background for continuous OpenCV frame processing) */}
        <div className={`w-full h-full ${viewMode === 'vision' ? 'opacity-0 pointer-events-none absolute inset-0' : 'relative'}`}>
          <CameraFeed 
            onVideoReady={handleVideoReady} 
            onContainerResize={handleContainerResize}
            zoomLevel={zoomLevel}
          >
            {isLoaded && !isCalibrated && (
              <CalibrationOverlay 
                containerWidth={containerSize.width || window.innerWidth} 
                containerHeight={containerSize.height || window.innerHeight} 
                onPointsChange={handlePointsChange}
                onSaveCalibration={handleCalibrationClick}
                cv={cv}
                videoElement={videoElement}
                zoomLevel={zoomLevel}
                onZoomChange={setZoomLevel}
              />
            )}
          </CameraFeed>
        </div>

        {/* Vision View (Perspektivkorrigerad 2D-Vy) */}
        {viewMode === 'vision' && (
          <div className="relative w-full h-full flex flex-col items-center justify-center p-4 bg-slate-950">
            {/* Top Vision Banner HUD */}
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-slate-900/90 border border-emerald-500/40 px-4 py-2 rounded-2xl shadow-2xl backdrop-blur-md flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
              <div className="flex flex-col">
                <span className="text-emerald-400 font-bold text-xs uppercase tracking-wider">
                  Vision Mode (2D Perspektivkorrigerad Vy)
                </span>
                <span className="text-slate-400 text-[10px]">
                  Visar var datorseendet beräknar att pilarna träffat på tavlan.
                </span>
              </div>
            </div>

            {/* 2D Warped Board Canvas Container */}
            <div className="relative aspect-square max-w-[85vh] max-h-[85vh] w-full bg-black rounded-3xl overflow-hidden border-2 border-emerald-500/40 shadow-[0_0_50px_rgba(16,185,129,0.2)] flex items-center justify-center">
              <canvas
                ref={debugCanvasRef}
                width={800}
                height={800}
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        )}

        {/* Dart Hit Toast Indicator */}
        {lastScoredDartLabel && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 animate-bounce bg-blue-600/90 text-white font-black text-2xl sm:text-3xl px-6 py-2 rounded-2xl border-2 border-blue-400 shadow-2xl backdrop-blur-md">
            + {lastScoredDartLabel}
          </div>
        )}
        
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-20">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
            <p className="text-slate-200 font-medium">Laddar Datorseende-motor...</p>
          </div>
        )}

        {/* Error Overlay */}
        {error && (
          <div className="absolute inset-0 bg-red-950/80 backdrop-blur-sm flex flex-col items-center justify-center z-20 p-6 text-center">
            <div className="bg-red-900/50 p-4 rounded-xl border border-red-500/30">
              <h2 className="text-red-400 font-bold text-lg mb-2">Ett fel uppstod</h2>
              <p className="text-red-200">{error.message}</p>
            </div>
          </div>
        )}
      </main>

      {/* 501 Scoreboard & Game Controls */}
      <Scoreboard
        currentScore={currentScore}
        currentTurnDarts={currentTurnDarts}
        isBust={isBust}
        isWon={isWon}
        onUndo={undoLastDart}
        onReset={() => resetGame(501)}
        isCalibrated={isCalibrated}
        onCalibrateClick={handleCalibrationClick}
        detectorState={detectorState}
        noiseLevel={noiseLevel}
        motionThreshold={motionThreshold}
        onThresholdChange={setMotionThreshold}
        debugCanvasRef={debugCanvasRef}
        viewMode={viewMode}
        onToggleViewMode={() => setViewMode(prev => prev === 'live' ? 'vision' : 'live')}
      />
    </div>
  );
}

