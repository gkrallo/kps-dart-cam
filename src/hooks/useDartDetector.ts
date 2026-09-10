import { RefObject, useEffect, useRef } from 'react';
import { Point } from '../types';
import { BOARD_MM, BOARD_PX, PX_PER_MM } from '../utils/dartMath';
import { detectDartAxisTip } from '../utils/dartTip';

/** Ringradier i den warpade bilden, härledda ur de officiella mm-måtten. */
const RING_PX = {
  innerBull: BOARD_MM.innerBull * PX_PER_MM,
  outerBull: BOARD_MM.outerBull * PX_PER_MM,
  tripleInner: BOARD_MM.tripleInner * PX_PER_MM,
  tripleOuter: BOARD_MM.tripleOuter * PX_PER_MM,
  doubleInner: BOARD_MM.doubleInner * PX_PER_MM,
  doubleOuter: BOARD_MM.doubleOuter * PX_PER_MM,
};

export interface DetectorDebug {
  state: string;
  /** Skilda pixlar mot referensbilden (av 640 000 i den warpade bilden). */
  baselineNoise: number;
  /** Skilda pixlar mot föregående bildruta. */
  movementNoise: number;
  motionThreshold: number;
  /** Senaste blobanalysen: varför blev det (inte) en pil. */
  lastAnalysis?: string;
}

export const useDartDetector = (
  cv: any,
  videoElement: HTMLVideoElement | null,
  transformMatrix: any | null,
  isActive: boolean,
  motionThreshold: number,
  debugCanvasRef: RefObject<HTMLCanvasElement | null>,
  onDartDetected: (tip: Point) => void,
  onDebugState?: (info: DetectorDebug) => void,
  /** Anropas när tavlan blivit tömd på pilar igen (efter minst en detekterad pil). */
  onBoardCleared?: () => void,
  /** Loggar utförligt till konsolen. Styrs av ?debug i URL:en. */
  debug = false,
) => {
  // Callbacks i refs: annars byggs hela effekten om vid varje kast, eftersom
  // onDartDetected får ny identitet när poängen ändras. Det allokerade om alla
  // Mat:er, läste om baseline och avbröt rAF-loopen mitt i spelet.
  const onDartDetectedRef = useRef(onDartDetected);
  const onDebugStateRef = useRef(onDebugState);
  const onBoardClearedRef = useRef(onBoardCleared);
  const motionThresholdRef = useRef(motionThreshold);
  const debugRef = useRef(debug);
  useEffect(() => {
    onDartDetectedRef.current = onDartDetected;
    onDebugStateRef.current = onDebugState;
    onBoardClearedRef.current = onBoardCleared;
    motionThresholdRef.current = motionThreshold;
    debugRef.current = debug;
  });

  const detectedDartsRef = useRef<Point[]>([]);

  useEffect(() => {
    if (!isActive) detectedDartsRef.current = [];
  }, [isActive]);

  useEffect(() => {
    if (!cv || !videoElement || !transformMatrix || !isActive) return;

    const dsize = new cv.Size(BOARD_PX, BOARD_PX);
    const border = new cv.Scalar(0, 0, 0, 255);

    // Alla Mat:er allokeras en gång och raderas i cleanup. Inga undantag -
    // OpenCV.js kör mot en WASM-heap som inte städas av garbage collectorn.
    const warped = new cv.Mat();
    const gray = new cv.Mat();
    const diff = new cv.Mat();
    const thresh = new cv.Mat();
    const diffPrev = new cv.Mat();
    const threshPrev = new cv.Mat();
    // Rå (owarpad) gråskala: spetsdetekteringen körs här, för i den warpade
    // bilden är pilkroppen utsmetad eftersom den sticker ut ur tavlans plan.
    const rawGray = new cv.Mat();
    const rawDiff = new cv.Mat();
    const rawThresh = new cv.Mat();
    const emptyDiff = new cv.Mat();
    const emptyThresh = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    let baseline: any = null;
    let previous: any = null;
    let rawBaseline: any = null;
    // Referensbild av den TOMMA tavlan (vid speluppstart). Används bara för att
    // avgöra när tavlan blivit tömd på pilar igen -> automatiskt spelarbyte.
    let emptyBaseline: any = null;
    let dartsSinceClear = 0;

    let rafId = 0;
    let stopped = false;
    let isStabilizing = false;
    let lastMotionTime = 0;
    let lastAnalysis: string | undefined;
    let lastLogTime = 0;
    let lastDebugEmit = 0;
    let lastEmittedState = '';
    let calmSince = 0; // hur länge scenen varit i stort sett orörd (för baseline-uppdatering)

    const grabFrame = () => {
      // En NY canvas varje bildruta. En återanvänd canvas med
      // willReadFrequently slutade ta emot nya videobildrutor på Android/Chrome
      // (Galaxy S25): drawImage(video) gav samma frusna bild om och om igen, så
      // movementNoise låste på 0 och ingen pil kunde detekteras trots att
      // videon uppenbart ändrades. En färsk GPU-backad canvas läser om varje
      // gång. getImageData sker då bara en gång per canvas → ingen
      // willReadFrequently-varning och ingen frysning.
      const canvas = document.createElement('canvas');
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      const frame = cv.imread(canvas);
      cv.warpPerspective(frame, warped, transformMatrix, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, border);
      cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
      // Sudda i GRÅSKALA, före tröskling. Den gamla koden suddade den binära
      // bilden efteråt, vilket i praktiken bara vidgade blobben och lyfte brus.
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      cv.cvtColor(frame, rawGray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(rawGray, rawGray, new cv.Size(5, 5), 0);
      frame.delete();
    };

    if (videoElement.videoWidth === 0) return;
    grabFrame();
    baseline = gray.clone();
    previous = gray.clone();
    emptyBaseline = gray.clone();
    rawBaseline = rawGray.clone();

    // Warpar en punkt från rå videokoordinat till 800x800-rummet.
    const warpPoint = (p: Point): Point => {
      const src = cv.matFromArray(1, 1, cv.CV_32FC2, [p.x, p.y]);
      const dst = new cv.Mat();
      try {
        cv.perspectiveTransform(src, dst, transformMatrix);
        return { x: dst.data32F[0], y: dst.data32F[1] };
      } finally {
        src.delete();
        dst.delete();
      }
    };

    const analyseNewBlob = () => {
      // Bildsubtraktion i RÅ bild - se rawGray ovan.
      cv.absdiff(rawGray, rawBaseline, rawDiff);
      cv.threshold(rawDiff, rawThresh, 15, 255, cv.THRESH_BINARY);
      cv.morphologyEx(rawThresh, rawThresh, cv.MORPH_OPEN, kernel);
      cv.morphologyEx(rawThresh, rawThresh, cv.MORPH_CLOSE, kernel);

      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(rawThresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);

      let bestIdx = -1;
      let bestArea = 0;
      for (let i = 0; i < contours.size(); i++) {
        const area = cv.contourArea(contours.get(i));
        if (area > bestArea) {
          bestArea = area;
          bestIdx = i;
        }
      }

      // Arean är relativ bildstorleken nu (rå bild, inte den fasta 800x800:an).
      const frameArea = rawGray.rows * rawGray.cols || 1;
      const minArea = frameArea * 0.0002;
      const maxArea = frameArea * 0.05;
      const nContours = contours.size();

      if (bestIdx === -1) {
        lastAnalysis = `ingen kontur (rå diff för liten)`;
      } else if (bestArea <= minArea) {
        lastAnalysis = `blob för liten: ${bestArea | 0} < ${minArea | 0} px`;
      } else if (bestArea >= maxArea) {
        lastAnalysis = `blob för stor: ${bestArea | 0} > ${maxArea | 0} px (hand/skugga/exponering?)`;
      }

      if (bestIdx !== -1 && bestArea > minArea && bestArea < maxArea) {
        const contour = contours.get(bestIdx);

        const points: Point[] = [];
        for (let i = 0; i < contour.rows; i++) {
          points.push({ x: contour.data32S[i * 2], y: contour.data32S[i * 2 + 1] });
        }

        // Formkontroll: en pil är avlång. Runda blobbar är skuggor eller brus.
        const rect = cv.minAreaRect(contour);
        const long = Math.max(rect.size.width, rect.size.height);
        const short = Math.max(Math.min(rect.size.width, rect.size.height), 1);
        const elongation = long / short;

        let tipRaw: Point | null = null;
        let how = '';
        try {
          const axis = detectDartAxisTip(points, { minElongation: 2 });
          if (axis && axis.confidence > 0.15) {
            // Axelanpassning + breddtest: fenan är bredare än spetsen.
            tipRaw = axis.tip;
            how = `axel (conf ${axis.confidence.toFixed(2)}, elong ${axis.elongation.toFixed(1)})`;
          } else if (elongation >= 2.5) {
            // Nästan frontal pil: axeln går inte att lita på. Blobbens
            // tyngdpunkt duger - parallaxen är liten när pilen pekar mot linsen.
            let mx = 0;
            let my = 0;
            for (const p of points) {
              mx += p.x;
              my += p.y;
            }
            tipRaw = { x: mx / points.length, y: my / points.length };
            how = `tyngdpunkt (elong ${elongation.toFixed(1)})`;
          } else {
            how = `för rund: axel ${axis ? 'conf ' + axis.confidence.toFixed(2) : 'null'}, minAreaRect-elong ${elongation.toFixed(1)} < 2.5`;
          }
        } catch (err) {
          console.error('Spetsdetektering misslyckades:', err);
          how = 'krasch i spetsdetektering';
        }

        if (tipRaw) {
          const tip = warpPoint(tipRaw);
          detectedDartsRef.current.push(tip);
          dartsSinceClear++;
          lastAnalysis = `PIL registrerad (${bestArea | 0} px, ${how})`;
          onDartDetectedRef.current(tip);
        } else {
          lastAnalysis = `blob OK (${bestArea | 0} px) men ${how}`;
        }
      }

      if (debugRef.current) console.log('[analyse]', nContours, 'konturer →', lastAnalysis);
      contours.delete();
      hierarchy.delete();
    };

    const drawOverlay = (state: string) => {
      const center = new cv.Point(BOARD_PX / 2, BOARD_PX / 2);
      const ring = (r: number, color: number[], thickness: number) =>
        cv.circle(warped, center, Math.round(r), new cv.Scalar(...color), thickness);

      ring(RING_PX.doubleOuter, [59, 130, 246, 255], 2);
      ring(RING_PX.doubleInner, [96, 165, 250, 255], 1);
      ring(RING_PX.tripleOuter, [239, 68, 68, 255], 2);
      ring(RING_PX.tripleInner, [248, 113, 113, 255], 1);
      ring(RING_PX.outerBull, [34, 197, 94, 255], 2);
      ring(RING_PX.innerBull, [239, 68, 68, 255], -1);

      for (let i = 0; i < 20; i++) {
        const rad = ((i * 18 - 9 - 90) * Math.PI) / 180;
        cv.line(
          warped,
          new cv.Point(
            BOARD_PX / 2 + RING_PX.outerBull * Math.cos(rad),
            BOARD_PX / 2 + RING_PX.outerBull * Math.sin(rad),
          ),
          new cv.Point(
            BOARD_PX / 2 + RING_PX.doubleOuter * Math.cos(rad),
            BOARD_PX / 2 + RING_PX.doubleOuter * Math.sin(rad),
          ),
          new cv.Scalar(148, 163, 184, 180),
          1,
        );
      }

      detectedDartsRef.current.forEach((pt, idx) => {
        const p = new cv.Point(pt.x, pt.y);
        cv.circle(warped, p, 16, new cv.Scalar(239, 68, 68, 255), 2);
        cv.circle(warped, p, 6, new cv.Scalar(34, 197, 94, 255), -1);
        cv.line(warped, new cv.Point(pt.x - 22, pt.y), new cv.Point(pt.x + 22, pt.y), new cv.Scalar(255, 255, 255, 255), 1);
        cv.line(warped, new cv.Point(pt.x, pt.y - 22), new cv.Point(pt.x, pt.y + 22), new cv.Scalar(255, 255, 255, 255), 1);
        cv.putText(warped, `P${idx + 1}`, new cv.Point(pt.x + 10, pt.y - 10), cv.FONT_HERSHEY_SIMPLEX, 0.7, new cv.Scalar(255, 255, 0, 255), 2);
      });

      if (state === 'MOTION' || state === 'STABILIZING') {
        cv.rectangle(warped, new cv.Point(5, 5), new cv.Point(BOARD_PX - 5, BOARD_PX - 5), new cv.Scalar(0, 0, 255, 255), 10);
      }

      if (debugCanvasRef.current) cv.imshow(debugCanvasRef.current, warped);
    };

    const processFrame = () => {
      if (stopped) return;
      rafId = requestAnimationFrame(processFrame);

      if (videoElement.paused || videoElement.ended || videoElement.videoWidth === 0) return;

      grabFrame();

      cv.absdiff(gray, baseline, diff);
      cv.threshold(diff, thresh, 30, 255, cv.THRESH_BINARY);
      const baselineNoise = cv.countNonZero(thresh);

      cv.absdiff(gray, previous, diffPrev);
      cv.threshold(diffPrev, threshPrev, 30, 255, cv.THRESH_BINARY);
      const movementNoise = cv.countNonZero(threshPrev);

      previous.delete();
      previous = gray.clone();

      const now = performance.now();
      let state = 'STABLE';

      if (movementNoise > motionThresholdRef.current) {
        lastMotionTime = now;
        isStabilizing = true;
        state = 'MOTION';
      } else if (baselineNoise > 500) {
        if (!isStabilizing) {
          isStabilizing = true;
          lastMotionTime = now;
        }
        if (now - lastMotionTime > 500) {
          isStabilizing = false;
          state = 'ANALYZING';
          analyseNewBlob();
          baseline.delete();
          baseline = gray.clone();
          rawBaseline.delete();
          rawBaseline = rawGray.clone();
        } else {
          state = 'STABILIZING';
        }
      } else {
        isStabilizing = false;

        // Tavlan tömd? Jämför mot den tomma referensbilden. Är den nästan
        // identisk igen, och vi hunnit registrera minst en pil, så har någon
        // dragit ur pilarna -> spelarbyte. Baseline nollställs så nästa pil
        // syns som en ny skillnad.
        if (dartsSinceClear > 0 && emptyBaseline) {
          cv.absdiff(gray, emptyBaseline, emptyDiff);
          cv.threshold(emptyDiff, emptyThresh, 30, 255, cv.THRESH_BINARY);
          if (cv.countNonZero(emptyThresh) < 400) {
            dartsSinceClear = 0;
            detectedDartsRef.current = [];
            baseline.delete();
            baseline = gray.clone();
            rawBaseline.delete();
            rawBaseline = rawGray.clone();
            calmSince = 0;
            state = 'CLEARED';
            lastAnalysis = 'tavlan tömd → spelarbyte';
            onBoardClearedRef.current?.();
          }
        }

        // Långsam baseline-uppdatering: kamerans autoexponering/vitbalans driver
        // med tiden, och då slutar en landad pil att sticka ut. Bara om scenen
        // varit i stort sett helt orörd (ingen pil ligger och väntar) i 15 s:
        // uppdatera referensbilden så driften inte ackumuleras. Snålt tilltaget
        // med flit - en för ivrig uppdatering äter en pil som ännu inte hunnit
        // analyseras.
        if (baselineNoise < 120 && movementNoise < 200) {
          if (calmSince === 0) calmSince = now;
          else if (now - calmSince > 15000) {
            baseline.delete();
            baseline = gray.clone();
            rawBaseline.delete();
            rawBaseline = rawGray.clone();
            if (dartsSinceClear === 0) {
              emptyBaseline.delete();
              emptyBaseline = gray.clone();
            }
            calmSince = now;
            if (debugRef.current) console.log('[det] baseline uppdaterad (drift)');
          }
        } else {
          calmSince = 0;
        }
      }

      if (debugRef.current && now - lastLogTime > 700) {
        lastLogTime = now;
        console.log(
          `[det] ${state}  baselineNoise=${baselineNoise}  movementNoise=${movementNoise}` +
            `  (motionTröskel=${motionThresholdRef.current}, baselineTröskel=500)` +
            (lastAnalysis ? `  senaste: ${lastAnalysis}` : ''),
        );
      }

      // Strypt: bara vid tillståndsbyte eller var 400:e ms - annars re-renderas
      // App varje bildruta.
      if (state !== lastEmittedState || now - lastDebugEmit > 400) {
        lastEmittedState = state;
        lastDebugEmit = now;
        onDebugStateRef.current?.({
          state,
          baselineNoise,
          movementNoise,
          motionThreshold: motionThresholdRef.current,
          lastAnalysis,
        });
      }
      drawOverlay(state);
    };

    rafId = requestAnimationFrame(processFrame);

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      // Varenda Mat måste raderas, inklusive baseline och previous - de
      // saknades i den gamla cleanupen och läckte två 800x800-bilder per kast.
      [
        warped, gray, diff, thresh, diffPrev, threshPrev,
        rawGray, rawDiff, rawThresh, emptyDiff, emptyThresh,
        kernel, baseline, previous, rawBaseline, emptyBaseline,
      ].forEach((m) => m?.delete());
      baseline = null;
      previous = null;
      emptyBaseline = null;
      rawBaseline = null;
    };
  }, [cv, videoElement, transformMatrix, isActive, debugCanvasRef]);
};
