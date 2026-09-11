import { useState, useRef, useCallback, useEffect } from 'react';
import { Loader2, Camera, Eye } from 'lucide-react';
import { CameraFeed } from './components/CameraFeed';
import { useOpenCV } from './hooks/useOpenCV';
import { CalibrationOverlay } from './components/CalibrationOverlay';
import { Point } from './types';
import { useDartDetector, type DetectorDebug } from './hooks/useDartDetector';
import { useMatch } from './hooks/useMatch';
import { getScoreFromPixel } from './utils/dartMath';
import { audioEngine } from './utils/audioEngine';
import { GameSetup } from './components/GameSetup';
import { segFromDartScore } from './game';
import { engineFor, matchState } from './game/match';
import type { ZoomCapability } from './components/CameraFeed';
import { Scoreboard } from './components/Scoreboard';

export default function App() {
  const { isLoaded, isLoading, error, cv } = useOpenCV();

  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [detectorState, setDetectorState] = useState<string>('INACTIVE');
  const [debugInfo, setDebugInfo] = useState<DetectorDebug | null>(null);
  const [motionThreshold, setMotionThreshold] = useState<number>(3000);
  const debugMode =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [zoomCapability, setZoomCapability] = useState<ZoomCapability>({
    supported: false, min: 1, max: 1, step: 0.1,
  });
  const [lastScoredDartLabel, setLastScoredDartLabel] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'live' | 'vision'>('live');
  const [showSetup, setShowSetup] = useState(false);

  const { match, state, start, quit, throwSeg, finishTurn, undoLast, editThrow, deleteThrow } = useMatch();

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  // Matrisen ligger i state, inte i en ref: den gamla varianten lästes under
  // render och fungerade bara för att setIsCalibrated råkade trigga en
  // omrendering direkt efteråt.
  const [transformMatrix, setTransformMatrix] = useState<any>(null);

  useEffect(() => () => transformMatrix?.delete(), [transformMatrix]);

  // När kalibreringen är klar men inget spel pågår: visa uppstartsskärmen.
  useEffect(() => {
    if (isCalibrated && !match) setShowSetup(true);
  }, [isCalibrated, match]);

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
    const scoreObj = getScoreFromPixel(pt.x, pt.y);
    const st = throwSeg(segFromDartScore(scoreObj));

    audioEngine.playDartHitSound();
    audioEngine.speakScore(scoreObj.label, scoreObj.totalPoints);

    setLastScoredDartLabel(scoreObj.label);
    window.setTimeout(() => setLastScoredDartLabel(null), 2500);

    // Farfar avslutar turen själv i motorn (ingen "Nästa"-knapp) - om just det
    // här kastet nollställde currentDarts är turen redan slut, och lastEvent
    // (satt av farfarEngine.throwDart) har allt vi behöver läsa upp: hur
    // många poäng omgången gav och hur många pilar som sparades (eller
    // "utslagen"). speak() köar efter speakScore ovan i stället för att
    // klippa av den.
    if (st && !engineFor(st.config).hasEndTurn && st.currentDarts.length === 0 && st.lastEvent) {
      const ev = st.lastEvent;
      const outcome = ev.type === 'ELIMINATED' ? 'Utslagen.' : `${ev.saved} sparade ${ev.saved === 1 ? 'pil' : 'pilar'}.`;
      audioEngine.speak(`${ev.name}: ${ev.total} poäng. ${outcome}`);
      if (!st.finished) {
        const next = st.players[st.currentIndex];
        if (next) audioEngine.speak(`${next.name}s tur`);
      }
    }
  }, [throwSeg]);

  const handleBoardCleared = useCallback(() => {
    if (!match) return;
    const st = matchState(match);
    const engine = engineFor(match.config);
    // 301/501: turen avslutas när tavlan töms. Farfar avslutar turen själv i
    // motorn (se handleDartDetected), så här räcker det att detektorn
    // nollställts.
    if (engine.hasEndTurn && !st.finished && st.currentDarts.length > 0) {
      // Läs upp summan och nya ställningen INNAN finishTurn() nollställer
      // currentDarts/flyttar currentIndex - st här är fortfarande "turen som
      // precis avslutades". Vinst annonseras separat (useEffect på
      // state.view.win) för att inte krocka med den fanfaren.
      const v = st.view;
      if (!v.win) {
        audioEngine.speak(v.bust ? `${st.active.name}: tjock, poängen räknas inte.` : `${st.active.name}: ${v.total} poäng. ${v.remaining} kvar.`);
      }
      finishTurn();
      audioEngine.playSwitchSound();
      const next = st.players[(st.currentIndex + 1) % st.players.length];
      if (next) audioEngine.speak(`${next.name}s tur`);
    }
  }, [match, finishTurn]);

  const handleDebugState = useCallback((info: DetectorDebug) => {
    setDetectorState(info.state);
    setDebugInfo(info);
  }, []);

  useDartDetector(
    cv,
    videoElement,
    transformMatrix,
    isCalibrated,
    motionThreshold,
    debugCanvasRef,
    handleDartDetected,
    handleDebugState,
    handleBoardCleared,
    debugMode,
  );

  // Vinst: annonsera och slutför turen så matchen registreras klar.
  useEffect(() => {
    if (state?.view.win && !state.finished) finishTurn();
    if (state?.finished && state.winners.length) {
      audioEngine.playWinSound();
      audioEngine.speak(`${state.winners.join(' och ')} vinner!`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.view.win, state?.finished]);

  const handleCalibrationClick = () => {
    if (isCalibrated) {
      setTransformMatrix(null); // effekten nedan raderar den gamla matrisen
      setIsCalibrated(false);
      return;
    }

    if (!cv || !videoElement) {
      console.warn('Kamera eller OpenCV inte redo för kalibrering ännu.');
      return;
    }
    if (calibrationPoints.length !== 4) {
      console.warn('4 kalibreringspunkter krävs, fick:', calibrationPoints.length);
      return;
    }

    let srcMat: any = null;
    let dstMat: any = null;
    try {
      // Videon visas med object-cover: skalad med max() och centrerad.
      const vw = videoElement.videoWidth;
      const vh = videoElement.videoHeight;
      const cw = containerSize.width || window.innerWidth;
      const ch = containerSize.height || window.innerHeight;

      const scale = Math.max(cw / vw, ch / vh);
      const offsetX = (cw - vw * scale) / 2;
      const offsetY = (ch - vh * scale) / 2;

      const videoPoints = calibrationPoints.map((p) => ({
        x: (p.x - offsetX) / scale,
        y: (p.y - offsetY) / scale,
      }));

      srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, videoPoints.flatMap((p) => [p.x, p.y]));
      // Målet: en 800x800-bild där radien 400 px motsvarar dubbelringens
      // ytterkant (170 mm). Se BOARD_PX/MM_PER_PX i dartMath.ts.
      dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, [
        400, 0, 800, 400, 400, 800, 0, 400,
      ]);

      setTransformMatrix(cv.getPerspectiveTransform(srcMat, dstMat));
      setIsCalibrated(true);
    } catch (err) {
      console.error('Kalibrering misslyckades:', err);
    } finally {
      srcMat?.delete();
      dstMat?.delete();
    }
  };

  const hasEndTurn = match ? engineFor(match.config).hasEndTurn : true;

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-slate-950 text-slate-50 overflow-hidden font-sans">
      {/* Header. Titeln visas bara efter kalibrering: under kalibreringen ligger
          CalibrationOverlays eget knapprad (Auto-Kalibrera m.fl.) i exakt samma
          hörn (top-3 left-3) och låg i samma z-lager som headern - texten och
          knapparna åt varandra. */}
      <header className="absolute top-0 w-full z-20 p-3 sm:p-4 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex justify-between items-center gap-2 pointer-events-none">
        {/* Vänster grupp som ett enda flex-barn, så statuspricken till höger inte
            hoppar över till vänster (justify-between med bara ett barn hamnar
            annars vid flex-start) när titeln och knapparna är dolda. */}
        <div className="flex items-center gap-2 min-w-0">
          {isCalibrated && (
            <h1 className="text-base sm:text-xl font-bold tracking-tight text-white drop-shadow-md truncate min-w-0">
              KPs DartApp
            </h1>
          )}

          {isCalibrated && (
            <div className="pointer-events-auto bg-slate-950/90 border border-slate-800 p-1 rounded-2xl shadow-2xl backdrop-blur-md flex items-center gap-1 shrink-0">
              <button
                onClick={() => setViewMode('live')}
                aria-label="Live-kamera"
                className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  viewMode === 'live' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Live</span>
              </button>
              <button
                onClick={() => setViewMode('vision')}
                aria-label="Vision 2D-vy"
                className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  viewMode === 'vision' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Eye className="w-3.5 h-3.5 text-emerald-300" />
                <span className="hidden sm:inline">Vision</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isLoaded ? (
            <span className="flex h-3 w-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]" title="OpenCV Datorseende Aktivt" />
          ) : (
            <span className="flex h-3 w-3 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]" title="Laddar OpenCV..." />
          )}
        </div>
      </header>

      {/* Main Viewport Container */}
      <main className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
        <div className={`w-full h-full ${viewMode === 'vision' ? 'opacity-0 pointer-events-none absolute inset-0' : 'relative'}`}>
          <CameraFeed
            onVideoReady={handleVideoReady}
            onContainerResize={handleContainerResize}
            onZoomCapability={setZoomCapability}
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
                zoomCapability={zoomCapability}
              />
            )}
          </CameraFeed>
        </div>

        {/* Vision View */}
        {viewMode === 'vision' && (
          <div className="relative w-full h-full flex flex-col items-center justify-center p-4 bg-slate-950">
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 max-w-[92vw] bg-slate-900/90 border border-emerald-500/40 px-4 py-2 rounded-2xl shadow-2xl backdrop-blur-md flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-emerald-400 font-bold text-xs uppercase tracking-wider">Vision-läge (2D-vy)</span>
                <span className="text-slate-400 text-[10px] truncate">Var datorseendet tror att pilarna träffat.</span>
              </div>
            </div>
            <div className="relative aspect-square max-w-[85vh] max-h-[85vh] w-full bg-black rounded-3xl overflow-hidden border-2 border-emerald-500/40 shadow-[0_0_50px_rgba(16,185,129,0.2)] flex items-center justify-center">
              <canvas ref={debugCanvasRef} width={800} height={800} className="w-full h-full object-contain" />
            </div>
          </div>
        )}

        {/* Debug HUD (?debug i URL:en) */}
        {debugMode && debugInfo && (
          <div className="absolute bottom-2 left-2 z-40 max-w-[70vw] bg-black/85 text-[10px] leading-tight font-mono text-emerald-300 px-2.5 py-2 rounded-lg border border-emerald-800/50 pointer-events-none">
            <div className="text-white font-bold">{debugInfo.state}</div>
            <div>baselineNoise {debugInfo.baselineNoise} <span className="text-slate-500">(&gt;500 → analys)</span></div>
            <div>movementNoise {debugInfo.movementNoise} <span className="text-slate-500">(&gt;{debugInfo.motionThreshold} → rörelse)</span></div>
            {debugInfo.lastAnalysis && <div className="text-amber-300 mt-1">{debugInfo.lastAnalysis}</div>}
          </div>
        )}

        {/* Dart Hit Toast */}
        {lastScoredDartLabel && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 animate-bounce bg-blue-600/90 text-white font-black text-2xl sm:text-3xl px-6 py-2 rounded-2xl border-2 border-blue-400 shadow-2xl backdrop-blur-md whitespace-nowrap">
            + {lastScoredDartLabel}
          </div>
        )}

        {/* Game Setup */}
        {isCalibrated && showSetup && (
          <GameSetup
            onStart={(opts) => {
              start(opts);
              setShowSetup(false);
              audioEngine.unlock();
            }}
            onSkip={match ? () => setShowSetup(false) : undefined}
          />
        )}

        {isLoading && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-20">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
            <p className="text-slate-200 font-medium">Laddar Datorseende-motor...</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 bg-red-950/80 backdrop-blur-sm flex flex-col items-center justify-center z-20 p-6 text-center">
            <div className="bg-red-900/50 p-4 rounded-xl border border-red-500/30">
              <h2 className="text-red-400 font-bold text-lg mb-2">Ett fel uppstod</h2>
              <p className="text-red-200">{error.message}</p>
            </div>
          </div>
        )}
      </main>

      <Scoreboard
        match={state}
        hasEndTurn={hasEndTurn}
        onUndo={undoLast}
        onFinishTurn={finishTurn}
        onEditThrow={editThrow}
        onDeleteThrow={deleteThrow}
        onNewGame={() => {
          quit();
          setShowSetup(true);
        }}
        isCalibrated={isCalibrated}
        onCalibrateClick={handleCalibrationClick}
        detectorState={detectorState}
        motionThreshold={motionThreshold}
        onThresholdChange={setMotionThreshold}
        debugCanvasRef={debugCanvasRef}
        viewMode={viewMode}
        onToggleViewMode={() => setViewMode((p) => (p === 'live' ? 'vision' : 'live'))}
      />
    </div>
  );
}
