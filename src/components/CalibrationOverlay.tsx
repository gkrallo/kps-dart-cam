import React, { useState, useEffect, useRef } from 'react';
import { Point } from '../types';
import {
  computeHomography,
  generateProjectedCircleSVG,
  getSectorBoundaryAngles,
} from '../utils/boardProjection';
import { alignSectorsToBoard, autoDetectBoardEllipse, autoDetectBoardOpenCV } from '../utils/boardDetector';
import {
  fromStored,
  loadCalibration,
  rotateCalibrationToAnchor,
  saveCalibration,
} from '../utils/calibration';
import type { ZoomCapability } from './CameraFeed';
import { Sparkles, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Focus, ZoomIn, CheckCircle2, SlidersHorizontal, X, RotateCcw, Crosshair, Target, SkipForward, Compass } from 'lucide-react';

interface CalibrationOverlayProps {
  containerWidth: number;
  containerHeight: number;
  onPointsChange: (points: Point[]) => void;
  onSaveCalibration?: () => void;
  cv?: any;
  videoElement?: HTMLVideoElement | null;
  zoomLevel?: number;
  onZoomChange?: (zoom: number) => void;
  zoomCapability?: ZoomCapability;
}

export const CalibrationOverlay: React.FC<CalibrationOverlayProps> = ({
  containerWidth,
  containerHeight,
  onPointsChange,
  onSaveCalibration,
  cv,
  videoElement,
  zoomLevel = 1,
  onZoomChange,
  zoomCapability,
}) => {
  const [points, setPoints] = useState<Point[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [detectStatus, setDetectStatus] = useState<string | null>(null);
  const [showDpad, setShowDpad] = useState<boolean>(false);
  const [anchorMode, setAnchorMode] = useState<boolean>(false);

  // "Sikte"-steget körs bara före punktplacering. Telefonen sitter fast på
  // stativ, så appen kan inte rikta om sig själv - det användaren GÖR är att
  // fysiskt flytta stativet tills tavlan ligger i hårkorset. Det appen kan
  // göra är att välja en bra zoomnivå automatiskt när den ser tavlan, i
  // stället för att användaren ska gissa sig fram med reglaget. Hoppas över
  // (går direkt till punktplacering) om en sparad kalibrering finns, så
  // återkommande användare inte tvingas igenom steget varje gång.
  const [calibrationStep, setCalibrationStep] = useState<'sikte' | 'punkter'>('sikte');
  const [isZoomingToBoard, setIsZoomingToBoard] = useState(false);
  const [siktStatus, setSiktStatus] = useState<string | null>(null);

  // Föregående zoomnivå, för att skala punkterna när användaren zoomar.
  const prevZoomRef = useRef(zoomLevel);

  // Initialize points only once when dimensions are available. Om en kalibrering
  // finns sparad sedan tidigare återställs den - annars en centrerad ring.
  useEffect(() => {
    if (points.length === 0 && containerWidth > 0 && containerHeight > 0) {
      const container = { width: containerWidth, height: containerHeight };
      const stored = loadCalibration();
      const restored = stored ? fromStored(stored, container) : null;
      // Zoomen tillhör kalibreringen: punkterna mättes vid den, och utan att
      // återställa den pekar de på helt fel ställen på tavlan. Se
      // StoredCalibration.zoom.
      if (restored && stored?.zoom !== undefined) {
        // Punkterna skalas INTE här: de mättes redan vid den här zoomen. Bara
        // reglaget skalar punkter (handleZoomSliderChange).
        //
        // Ingen koll mot `zoomCapability.supported`: den kommer från kameran
        // via onZoomCapability och hinner inte fram innan den här effekten
        // kör (den triggas av containerns storlek, som är klar långt
        // tidigare). Med kollen hoppades zoomen tyst över och kalibreringen
        // återställdes mot 1x - uppmätt 2026-09-12. CameraFeed klampar ändå
        // mot kamerans verkliga gränser och struntar i värdet om zoom inte
        // stöds, så det är ofarligt att alltid skicka det.
        prevZoomRef.current = stored.zoom;
        onZoomChange?.(stored.zoom);
      }

      const cx = containerWidth / 2;
      const cy = containerHeight / 2;
      const r = Math.min(containerWidth, containerHeight) * 0.22;
      const initialPoints =
        restored ?? [
          { x: cx, y: cy - r }, // Top (12 o'clock)
          { x: cx + r, y: cy }, // Right (3 o'clock)
          { x: cx, y: cy + r }, // Bottom (6 o'clock)
          { x: cx - r, y: cy }, // Left (9 o'clock)
        ];
      setPoints(initialPoints);
      onPointsChange(initialPoints);
      if (restored) {
        setCalibrationStep('punkter');
        setDetectStatus('Sparad kalibrering återställd. Justera vid behov.');
        window.setTimeout(() => setDetectStatus(null), 5000);
      }
    }
  }, [containerWidth, containerHeight]);

  // Delad detekteringslogik: ellipsmetoden klarar sneda kameravinklar;
  // HoughCircles (cirkel-antagande) är fallback om färgsegmenteringen inte
  // hittar ringarna. Används av både "Auto-Kalibrera" och sikte-steget.
  const runBoardDetection = (): Point[] | null => {
    if (!videoElement || !cv) return null;
    return (
      autoDetectBoardEllipse(cv, videoElement, containerWidth, containerHeight) ??
      autoDetectBoardOpenCV(cv, videoElement, containerWidth, containerHeight)
    );
  };

  // Sikta-steget: hitta tavlan vid nuvarande zoom, räkna ut vilken zoomnivå
  // som fyller ramen lagom mycket, applicera hårdvaruzoomen, och detektera om
  // en gång till när bilden hunnit stabilisera sig - den andra detekteringen
  // blir träffsäkrare eftersom tavlan nu fyller mer av bilden.
  const handleAutoZoomToBoard = () => {
    if (!videoElement || !cv) {
      setSiktStatus('Kameran eller datorseendet är inte redo ännu.');
      window.setTimeout(() => setSiktStatus(null), 4000);
      return;
    }

    setIsZoomingToBoard(true);
    setSiktStatus('Letar efter tavlan...');

    requestAnimationFrame(() => {
      const rough = runBoardDetection();
      if (!rough) {
        setSiktStatus('Hittade ingen tavla än. Håll stativet stilla med tavlan i bild, eller hoppa över och placera punkterna manuellt.');
        setIsZoomingToBoard(false);
        window.setTimeout(() => setSiktStatus(null), 6000);
        return;
      }

      if (!onZoomChange || !zoomCapability?.supported) {
        // Ingen hårdvaruzoom på den här telefonen - använd träffen direkt.
        setPoints(rough);
        onPointsChange(rough);
        setCalibrationStep('punkter');
        setIsZoomingToBoard(false);
        return;
      }

      const cx = rough.reduce((s, p) => s + p.x, 0) / rough.length;
      const cy = rough.reduce((s, p) => s + p.y, 0) / rough.length;
      const avgR = rough.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / rough.length;
      // Målet: dubbelringens ytterkant ska nå ~40% av kortsidan - samma
      // storlek som "Återställ"-cirkeln (0.36-0.4) håller sig till, så
      // punkterna hamnar inom bekväma dragavstånd även efter zoomen.
      const targetR = Math.min(containerWidth, containerHeight) * 0.4;
      const factor = avgR > 0 ? targetR / avgR : 1;
      const target = Math.min(zoomCapability.max, Math.max(zoomCapability.min, zoomLevel * factor));

      setSiktStatus('Zoomar in mot tavlan...');
      // Punkterna skalas inte heller här - de detekteras om efter zoomen
      // nedan. prevZoomRef måste ändå följa med, annars räknar nästa drag i
      // reglaget sin faktor från fel utgångsläge.
      prevZoomRef.current = target;
      onZoomChange(target);

      // Kamerans hårdvaruzoom (och autoexponering som ställer om sig efter
      // den) tar en liten stund - vänta innan vi litar på nästa bildruta.
      window.setTimeout(() => {
        const refined = runBoardDetection() ?? rough;
        setPoints(refined);
        onPointsChange(refined);
        setCalibrationStep('punkter');
        setIsZoomingToBoard(false);
        setSiktStatus(null);
      }, 700);
    });
  };

  // Riktar in sektorhjulet mot tavlans verkliga trådar utifrån röd/grön-
  // växlingen i ringarna. Fungerar oavsett hur punkterna hamnade där de är -
  // autodetekterade, sparade eller handdragna - och ändrar bara rotationen.
  // Det här är rättningen som annars måste göras genom att dra alla fyra
  // punkterna längs ringen för hand.
  const handleAlignSectors = () => {
    if (!videoElement || !cv || points.length !== 4) return;
    const res = alignSectorsToBoard(cv, videoElement, points, containerWidth, containerHeight);
    if (!res) {
      setDetectStatus(
        'Kunde inte läsa av ringarnas färger. Mer ljus på tavlan, eller peka ut 20:an för hand.',
      );
      window.setTimeout(() => setDetectStatus(null), 6000);
      return;
    }
    setPoints(res.points);
    onPointsChange(res.points);
    const d = res.offsetDeg;
    setDetectStatus(
      Math.abs(d) < 0.3
        ? 'Sektorerna satt redan rätt.'
        : `Sektorerna vred ${Math.abs(d).toFixed(1)}° ${d > 0 ? 'medurs' : 'moturs'}.`,
    );
    window.setTimeout(() => setDetectStatus(null), 5000);
  };

  const handlePointerDown = (idx: number, e: React.PointerEvent) => {
    if (anchorMode) return; // i utpekningsläge ska trycket rotera, inte dra
    e.preventDefault();
    setActiveIdx(idx);
    setDraggingIdx(idx);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  // I utpekningsläge: ett tryck var som helst säger var 20:an sitter.
  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!anchorMode || points.length !== 4) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const tap = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const rotated = rotateCalibrationToAnchor(points, tap);
    setPoints(rotated);
    onPointsChange(rotated);
    setAnchorMode(false);
    setDetectStatus('20:an placerad.');
    window.setTimeout(() => setDetectStatus(null), 2500);
  };

  const handleSaveCalibration = () => {
    if (points.length === 4 && containerWidth > 0 && containerHeight > 0) {
      // Zoomen måste med - se kommentaren vid StoredCalibration.zoom.
      saveCalibration(points, { width: containerWidth, height: containerHeight }, zoomLevel);
    }
    onSaveCalibration?.();
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (draggingIdx === null) return;

    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newPoints = [...points];
    newPoints[draggingIdx] = { x, y };
    setPoints(newPoints);
    onPointsChange(newPoints);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingIdx !== null) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    }
    setDraggingIdx(null);
  };

  // Micro-adjustment nudge
  const nudge = (dx: number, dy: number) => {
    if (points.length !== 4) return;
    const newPoints = [...points];
    newPoints[activeIdx] = {
      x: newPoints[activeIdx].x + dx,
      y: newPoints[activeIdx].y + dy,
    };
    setPoints(newPoints);
    onPointsChange(newPoints);
  };

  // Auto-Detect Board handler (100% lokalt, ingen backend och inget API)
  const handleAutoDetect = () => {
    if (!videoElement || !cv) {
      setDetectStatus('Kameran eller datorseendet är inte redo ännu.');
      window.setTimeout(() => setDetectStatus(null), 4000);
      return;
    }

    setIsDetecting(true);
    setDetectStatus('Söker efter darttavlan...');

    // requestAnimationFrame så att skann-overlayen hinner ritas ut innan
    // OpenCV blockerar huvudtråden.
    requestAnimationFrame(() => {
      const detected = runBoardDetection();

      if (detected) {
        setPoints(detected);
        onPointsChange(detected);
        setDetectStatus('Darttavla hittad. Kontrollera att 20:an är i toppen!');
      } else {
        setDetectStatus('Ingen tavla hittades. Rikta kameran mot tavlan, eller dra punkterna manuellt.');
      }

      setIsDetecting(false);
      window.setTimeout(() => setDetectStatus(null), 5000);
    });
  };

  // Reset 4 points to standard circle centered on screen
  const resetToDefaultCircle = () => {
    if (containerWidth <= 0 || containerHeight <= 0) return;
    const cx = containerWidth / 2;
    const cy = containerHeight / 2;
    const r = Math.min(containerWidth, containerHeight) * 0.36;
    const defaultPts: Point[] = [
      { x: cx, y: cy - r }, // Top (20)
      { x: cx + r, y: cy }, // Right (6)
      { x: cx, y: cy + r }, // Bottom (3)
      { x: cx - r, y: cy }, // Left (11)
    ];
    setPoints(defaultPts);
    onPointsChange(defaultPts);
    setDetectStatus('Återställde kalibreringspunkterna till mitten.');
    setTimeout(() => setDetectStatus(null), 3000);
  };

  /**
   * Användaren drog i zoomreglaget: hårdvaruzoomen beskär bilden kring mitten,
   * så punkterna måste följa med utåt/inåt för att fortsätta peka på samma
   * ställen på tavlan.
   *
   * Det här satt förut i en `useEffect` på `zoomLevel`, men det gick inte att
   * skilja "användaren zoomade" från "zoomen återställdes med en sparad
   * kalibrering" - och i det senare fallet ÄR punkterna redan mätta vid den
   * zoomen. Effekten skalade dem en andra gång, och eftersom React hann
   * rendera mellan `setPoints` och propen som kom tillbaka gick det inte att
   * neutralisera med en "föregående zoom"-ref: rescale-effekten skrev över
   * den på mellanrenderingen. Uppmätt 2026-09-12: alla fyra punkter hamnade
   * 2.07x för långt ut efter en omladdning. Skalningen hör till handlingen,
   * inte till propens värde.
   */
  const handleZoomSliderChange = (next: number) => {
    const oldZoom = prevZoomRef.current;
    if (points.length === 4 && containerWidth > 0 && containerHeight > 0 && oldZoom > 0) {
      const cx = containerWidth / 2;
      const cy = containerHeight / 2;
      const factor = next / oldZoom;
      const scaledPoints = points.map((p) => ({
        x: (p.x - cx) * factor + cx,
        y: (p.y - cy) * factor + cy,
      }));
      setPoints(scaledPoints);
      onPointsChange(scaledPoints);
    }
    prevZoomRef.current = next;
    onZoomChange?.(next);
  };

  // Förstoringsglas medan man drar en punkt: fingret skymmer själva pixeln man
  // försöker pricka, så en cirkulär ~3x-inzoomning ritas ovanför fingret med ett
  // hårkors. Videon visas med object-cover (skalad Math.max, centrerad) - samma
  // mappning måste användas för att plocka rätt videopixel.
  const LOUPE = 132;
  const LOUPE_ZOOM = 3;

  useEffect(() => {
    const canvas = loupeRef.current;
    if (draggingIdx === null || !canvas || !videoElement || videoElement.videoWidth === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const p = points[draggingIdx];
    if (!p) return;

    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;
    const scale = Math.max(containerWidth / vw, containerHeight / vh);
    const offX = (containerWidth - vw * scale) / 2;
    const offY = (containerHeight - vh * scale) / 2;
    const vx = (p.x - offX) / scale;
    const vy = (p.y - offY) / scale;

    const srcSize = LOUPE / (scale * LOUPE_ZOOM);

    ctx.clearRect(0, 0, LOUPE, LOUPE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(LOUPE / 2, LOUPE / 2, LOUPE / 2, 0, Math.PI * 2);
    ctx.clip();
    try {
      ctx.drawImage(videoElement, vx - srcSize / 2, vy - srcSize / 2, srcSize, srcSize, 0, 0, LOUPE, LOUPE);
    } catch {
      // drawImage kan kasta om videon inte är redo - hoppa över bildrutan
    }
    // Hårkors
    ctx.strokeStyle = 'rgba(59,130,246,0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(LOUPE / 2, LOUPE / 2 - 14);
    ctx.lineTo(LOUPE / 2, LOUPE / 2 + 14);
    ctx.moveTo(LOUPE / 2 - 14, LOUPE / 2);
    ctx.lineTo(LOUPE / 2 + 14, LOUPE / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(LOUPE / 2, LOUPE / 2, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }, [draggingIdx, points, videoElement, containerWidth, containerHeight]);

  const labels = ['Topp (20)', 'Höger (6)', 'Botten (3)', 'Vänster (11)'];

  // Placera förstoringsglaset ovanför fingret, eller under om punkten sitter
  // högt upp, och håll det innanför skärmkanterna.
  const loupePos = (() => {
    if (draggingIdx === null) return null;
    const p = points[draggingIdx];
    if (!p) return null;
    const margin = 8;
    let top = p.y - LOUPE - 48;
    if (top < margin) top = p.y + 48;
    let left = p.x - LOUPE / 2;
    left = Math.max(margin, Math.min(left, containerWidth - LOUPE - margin));
    return { left, top };
  })();

  // Sikte-steget: bara ett hårkors mitt i bild + zoomkontroller. Inga
  // dragbara punkter än - de kommer i nästa steg, antingen från
  // "Zooma till tavlan" eller från "Hoppa över" (då startar de som en
  // centrerad cirkel, precis som innan sikte-steget fanns).
  if (calibrationStep === 'sikte') {
    return (
      <div className="absolute inset-0 w-full h-full pointer-events-none z-10 flex flex-col justify-between overflow-hidden">
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <g className="opacity-90">
            <circle
              cx={containerWidth / 2}
              cy={containerHeight / 2}
              r={28}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="2.5"
            />
            <circle cx={containerWidth / 2} cy={containerHeight / 2} r={4} fill="#f59e0b" />
            <line
              x1={containerWidth / 2 - 46}
              y1={containerHeight / 2}
              x2={containerWidth / 2 - 34}
              y2={containerHeight / 2}
              stroke="#f59e0b"
              strokeWidth="2.5"
            />
            <line
              x1={containerWidth / 2 + 34}
              y1={containerHeight / 2}
              x2={containerWidth / 2 + 46}
              y2={containerHeight / 2}
              stroke="#f59e0b"
              strokeWidth="2.5"
            />
            <line
              x1={containerWidth / 2}
              y1={containerHeight / 2 - 46}
              x2={containerWidth / 2}
              y2={containerHeight / 2 - 34}
              stroke="#f59e0b"
              strokeWidth="2.5"
            />
            <line
              x1={containerWidth / 2}
              y1={containerHeight / 2 + 34}
              x2={containerWidth / 2}
              y2={containerHeight / 2 + 46}
              stroke="#f59e0b"
              strokeWidth="2.5"
            />
          </g>
        </svg>

        <div className="absolute top-3 left-3 right-3 pointer-events-auto flex flex-col items-center gap-2 z-20">
          <div className="bg-slate-950/90 border border-amber-500/40 px-4 py-2.5 rounded-2xl shadow-2xl backdrop-blur-md text-center max-w-sm">
            <div className="text-amber-400 font-bold text-xs uppercase tracking-wider mb-1">Sikta in tavlan</div>
            <p className="text-slate-300 text-[11px] leading-snug">
              Flytta eller vinkla stativet tills bullseye ligger i hårkorset. Tryck sedan
              "Zooma till tavlan" - appen hittar tavlan och väljer en lagom zoomnivå åt dig.
            </p>
          </div>

          {onZoomChange && zoomCapability?.supported && (
            <div className="flex items-center gap-2 bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-2xl border border-slate-800 text-xs shadow-xl">
              <ZoomIn className="w-3.5 h-3.5 text-blue-400" />
              <input
                type="range"
                min={zoomCapability.min}
                max={zoomCapability.max}
                step={zoomCapability.step}
                value={zoomLevel}
                onChange={(e) => handleZoomSliderChange(Number(e.target.value))}
                className="w-32 sm:w-48 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <span className="font-mono text-blue-400 font-bold text-xs">{zoomLevel.toFixed(1)}x</span>
            </div>
          )}

          {siktStatus && (
            <span className="text-[11px] leading-snug text-amber-300 font-semibold bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-amber-500/40 shadow-lg text-center max-w-sm">
              {siktStatus}
            </span>
          )}
        </div>

        <div className="absolute bottom-3 left-3 right-3 pointer-events-auto flex items-center justify-center gap-2 z-20">
          <button
            onClick={handleAutoZoomToBoard}
            disabled={isZoomingToBoard}
            className="bg-amber-500 hover:bg-amber-400 active:scale-95 disabled:opacity-50 text-slate-950 px-4 py-2.5 rounded-2xl font-bold text-xs sm:text-sm flex items-center gap-1.5 shadow-xl shadow-amber-500/20 backdrop-blur-md border border-amber-400/50 transition-all"
          >
            <Target className="w-4 h-4" />
            <span>{isZoomingToBoard ? 'Zoomar...' : 'Zooma till tavlan'}</span>
          </button>
          <button
            onClick={() => setCalibrationStep('punkter')}
            className="bg-slate-900/90 hover:bg-slate-800 text-slate-300 active:scale-95 px-3 py-2.5 rounded-2xl font-bold text-xs sm:text-sm flex items-center gap-1.5 border border-slate-700/80 shadow-lg backdrop-blur-md transition-all"
          >
            <SkipForward className="w-4 h-4" />
            <span>Hoppa över</span>
          </button>
        </div>
      </div>
    );
  }

  // Calculate 3D projective wireframe using Homography
  const project = computeHomography(points);

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none z-10 flex flex-col justify-between overflow-hidden">
      {/* High-Tech Animated Scanning HUD Overlay when Auto-Detecting */}
      {isDetecting && (
        <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden bg-slate-950/40 backdrop-blur-[1px] flex items-center justify-center">
          {/* Sweeping Laser Scanline */}
          <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_20px_#f59e0b] animate-laser-scan z-10" />

          {/* Central Radar Target Reticle */}
          <div className="relative w-64 h-64 sm:w-80 sm:h-80 flex items-center justify-center">
            <div className="absolute inset-0 border-2 border-dashed border-amber-400/60 rounded-full animate-radar-spin" />
            <div className="absolute inset-3 border border-blue-500/40 rounded-full animate-pulse" />
            <div className="absolute inset-12 border border-blue-400/30 rounded-full" />
            
            <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-amber-400" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-amber-400" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-amber-400" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-amber-400" />

            <div className="absolute w-full h-[1px] bg-amber-400/40" />
            <div className="absolute h-full w-[1px] bg-amber-400/40" />

            <div className="w-8 h-8 rounded-full border-2 border-amber-400 bg-amber-400/20 flex items-center justify-center animate-ping" />
          </div>

          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-slate-950/90 border border-amber-500/50 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-md flex items-center gap-3 z-20">
            <div className="w-3 h-3 rounded-full bg-amber-400 animate-ping" />
            <div className="flex flex-col">
              <span className="text-amber-400 font-bold text-xs tracking-wider uppercase">
                {detectStatus || 'Skannar Darttavla...'}
              </span>
              <span className="text-slate-400 text-[10px]">Identifierar dubbelring, tårtbitar & bullseye...</span>
            </div>
          </div>
        </div>
      )}

      {/* SVG Layer for Points and Wireframe Overlay */}
      <svg
        className={`absolute inset-0 w-full h-full touch-none pointer-events-auto ${
          anchorMode ? 'cursor-crosshair' : ''
        }`}
        onPointerDown={handleSvgPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Render Projected Dartboard Wireframe Grid if homography computed */}
        {project && (
          <g className="pointer-events-none opacity-85">
            {/* Outer Double Ring (170mm) & Inner Double Ring (162mm) */}
            <path
              d={generateProjectedCircleSVG(170, project)}
              fill="rgba(59, 130, 246, 0.08)"
              stroke="#3b82f6"
              strokeWidth="2"
            />
            <path
              d={generateProjectedCircleSVG(162, project)}
              fill="none"
              stroke="#60a5fa"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />

            {/* Outer Triple Ring (107mm) & Inner Triple Ring (97mm) */}
            <path
              d={generateProjectedCircleSVG(107, project)}
              fill="rgba(239, 68, 68, 0.08)"
              stroke="#ef4444"
              strokeWidth="1.5"
            />
            <path
              d={generateProjectedCircleSVG(97, project)}
              fill="none"
              stroke="#f87171"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />

            {/* Outer Bull (15.9mm) & Inner Bull (6.35mm) */}
            <path
              d={generateProjectedCircleSVG(15.9, project)}
              fill="rgba(34, 197, 94, 0.2)"
              stroke="#22c55e"
              strokeWidth="1.5"
            />
            <path
              d={generateProjectedCircleSVG(6.35, project)}
              fill="rgba(239, 68, 68, 0.6)"
              stroke="#ffffff"
              strokeWidth="1.5"
            />

            {/* Sector Boundary Radial Lines */}
            {getSectorBoundaryAngles().map((angleDeg, i) => {
              const rad = (angleDeg * Math.PI) / 180;
              const innerPt = project(15.9 * Math.cos(rad), 15.9 * Math.sin(rad));
              const outerPt = project(170 * Math.cos(rad), 170 * Math.sin(rad));
              return (
                <line
                  key={i}
                  x1={innerPt.x}
                  y1={innerPt.y}
                  x2={outerPt.x}
                  y2={outerPt.y}
                  stroke="#94a3b8"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              );
            })}
          </g>
        )}

        {/* Outer quad boundary line */}
        <polygon
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="2.5"
          className="pointer-events-none"
        />

        {/* Draw interactive calibration nodes */}
        {points.map((p, idx) => (
          <g
            key={idx}
            transform={`translate(${p.x}, ${p.y})`}
            onPointerDown={(e) => handlePointerDown(idx, e)}
            className="cursor-move touch-none"
          >
            {/* Larger transparent touch area */}
            <circle r="32" fill="transparent" />

            {/* Active highlight pulse ring */}
            {activeIdx === idx && (
              <circle r="22" fill="none" stroke="#3b82f6" strokeWidth="2.5" className="animate-ping opacity-75" />
            )}

            {/* Node body */}
            <circle
              r="14"
              fill={activeIdx === idx ? '#3b82f6' : '#ef4444'}
              stroke="#ffffff"
              strokeWidth="3"
              className="transition-colors duration-150 shadow-lg"
            />
            <text
              y="-22"
              textAnchor="middle"
              fill="white"
              className="text-xs font-bold pointer-events-none select-none"
              style={{ textShadow: '0px 2px 5px rgba(0,0,0,0.9)' }}
            >
              {labels[idx]}
            </text>
          </g>
        ))}
      </svg>

      {/* Förstoringsglas medan en punkt dras */}
      {loupePos && (
        <canvas
          ref={loupeRef}
          width={LOUPE}
          height={LOUPE}
          className="absolute z-30 pointer-events-none rounded-full border-2 border-blue-400 shadow-2xl bg-slate-950"
          style={{ left: loupePos.left, top: loupePos.top, width: LOUPE, height: LOUPE }}
        />
      )}

      {/* TOP FLOATING BAR: Auto-Detect & Zoom Controls */}
      <div className="absolute top-3 left-3 right-3 pointer-events-auto flex items-start justify-between gap-2 z-20">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <button
            onClick={handleAutoDetect}
            disabled={isDetecting}
            className="bg-amber-500 hover:bg-amber-400 active:scale-95 disabled:opacity-50 text-slate-950 px-3 py-2 rounded-2xl font-bold text-xs flex items-center gap-1.5 shadow-xl shadow-amber-500/20 backdrop-blur-md border border-amber-400/50 transition-all shrink-0"
          >
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Auto-Kalibrera Tavla</span>
            <span className="sm:hidden">Auto</span>
          </button>

          <button
            onClick={() => setAnchorMode((v) => !v)}
            className={`active:scale-95 px-2.5 py-2 rounded-2xl font-bold text-xs flex items-center gap-1 border shadow-lg backdrop-blur-md transition-all ${
              anchorMode
                ? 'bg-blue-600 text-white border-blue-400'
                : 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border-slate-700/80'
            }`}
            title="Tryck där 20:an sitter så vrids kalibreringen rätt"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{anchorMode ? 'Tryck på 20:an…' : 'Peka ut 20:an'}</span>
          </button>

          <button
            onClick={handleAlignSectors}
            className="bg-slate-900/90 hover:bg-slate-800 text-slate-300 active:scale-95 px-2.5 py-2 rounded-2xl font-bold text-xs flex items-center gap-1 border border-slate-700/80 shadow-lg backdrop-blur-md transition-all"
            title="Vrider sektorhjulet så att de streckade linjerna hamnar på tavlans riktiga trådar"
          >
            <Compass className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Rikta in sektorer</span>
          </button>

          <button
            onClick={resetToDefaultCircle}
            className="bg-slate-900/90 hover:bg-slate-800 text-slate-300 active:scale-95 px-2.5 py-2 rounded-2xl font-bold text-xs flex items-center gap-1 border border-slate-700/80 shadow-lg backdrop-blur-md transition-all"
            title="Återställ punkterna till en centrerad cirkel på skärmen"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Återställ</span>
          </button>

          <button
            onClick={() => setCalibrationStep('sikte')}
            className="bg-slate-900/90 hover:bg-slate-800 text-slate-300 active:scale-95 px-2.5 py-2 rounded-2xl font-bold text-xs flex items-center gap-1 border border-slate-700/80 shadow-lg backdrop-blur-md transition-all"
            title="Tillbaka till sikte- och zoomsteget"
          >
            <Target className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Sikte</span>
          </button>

          {detectStatus && (
            <span className="w-full sm:w-auto sm:max-w-xs text-[11px] leading-snug text-amber-300 font-semibold bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-amber-500/40 shadow-lg">
              {detectStatus}
            </span>
          )}
        </div>

        {/* Zoomreglage - visas bara om kameran faktiskt stödjer hårdvaruzoom.
            Digital CSS-zoom är borttagen: den beskar bara bilden utan att
            tillföra en enda pixel, och gav dubbel zoom ihop med hårdvaran. */}
        {onZoomChange && zoomCapability?.supported && (
          <div className="flex items-center gap-2 bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-2xl border border-slate-800 text-xs shadow-xl shrink-0">
            <ZoomIn className="w-3.5 h-3.5 text-blue-400" />
            <input
              type="range"
              min={zoomCapability.min}
              max={zoomCapability.max}
              step={zoomCapability.step}
              value={zoomLevel}
              onChange={(e) => handleZoomSliderChange(Number(e.target.value))}
              className="w-16 sm:w-24 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <span className="font-mono text-blue-400 font-bold text-xs">{zoomLevel.toFixed(1)}x</span>
          </div>
        )}
      </div>

      {/* POPUP D-PAD OVERLAY (Collapsible Fine-Tuning Pad) */}
      {showDpad && (
        <div className="absolute bottom-16 right-3 pointer-events-auto z-30 bg-slate-950/95 border border-slate-800 p-3 rounded-2xl shadow-2xl backdrop-blur-md flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-300 pb-1 border-b border-slate-800">
            <span className="flex items-center gap-1">
              <Focus className="w-3.5 h-3.5 text-blue-400" />
              <span>Finjustera {labels[activeIdx].split(' ')[0]}</span>
            </span>
            <button
              onClick={() => setShowDpad(false)}
              className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-center gap-2 pt-1">
            <div className="flex items-center gap-1 bg-slate-900 p-1.5 rounded-xl border border-slate-800">
              <button
                onClick={() => nudge(-1, 0)}
                className="p-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white rounded-lg transition-colors"
                title="Vänster 1px"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => nudge(0, -1)}
                  className="p-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white rounded-lg transition-colors"
                  title="Upp 1px"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => nudge(0, 1)}
                  className="p-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white rounded-lg transition-colors"
                  title="Ner 1px"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={() => nudge(1, 0)}
                className="p-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white rounded-lg transition-colors"
                title="Höger 1px"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-1.5 text-[10px] text-slate-400">
              <button
                onClick={() => nudge(0, -5)}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 rounded-lg font-bold"
              >
                +5px Upp
              </button>
              <button
                onClick={() => nudge(0, 5)}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 rounded-lg font-bold"
              >
                +5px Ner
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM FLOATING CONTROL BAR */}
      <div className="absolute bottom-3 left-3 right-3 pointer-events-auto z-20 bg-slate-950/90 backdrop-blur-md border border-slate-800/80 p-2 sm:p-2.5 rounded-2xl shadow-2xl flex items-center justify-between gap-2">
        {/* Left Side: Point Selector Tabs & Fine-Tune D-Pad Toggle */}
        <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto py-0.5">
          {labels.map((lbl, idx) => (
            <button
              key={idx}
              onClick={() => setActiveIdx(idx)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                activeIdx === idx
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {lbl.split(' ')[0]}
            </button>
          ))}

          {/* Finjustera (D-Pad) Toggle Button */}
          <button
            onClick={() => setShowDpad(!showDpad)}
            className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all ${
              showDpad
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
            title="Öppna finjusteringsknappar"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pilknappar</span>
          </button>
        </div>

        {/* Right Side: Primary Save Button */}
        <button
          onClick={handleSaveCalibration}
          className="bg-blue-600 hover:bg-blue-500 active:scale-95 text-white px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm shadow-lg shadow-blue-600/30 flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0"
        >
          <CheckCircle2 className="w-4 h-4 text-white" />
          <span>Starta Spel</span>
        </button>
      </div>
    </div>
  );
};

