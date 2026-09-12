import { RefObject, useEffect, useRef } from 'react';
import { Point } from '../types';
import { BOARD_MM, BOARD_PX, MM_PER_PX, PX_PER_MM, getScoreFromPixel } from '../utils/dartMath';
import { chooseDartTip, detectDartAxisTip } from '../utils/dartTip';
import { classifyShadow, type BlobSample } from '../utils/shadowTest';
import { boundingRect, groupFragments, minAreaRect } from '../utils/blobGroups';
import {
  interpretCensus,
  reconcileDarts,
  type CensusVerdict,
  type MaterialDelta,
} from '../utils/dartCensus';

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

/** Resultatet av att leta pilform i en tröskad diffbild. */
interface TipFind {
  tip: Point;
  how: string;
  /** Blobbens omskrivande rektangel, för `absorbBlobRegion`. */
  rect: { x: number; y: number; width: number; height: number };
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
  /**
   * Anropas när en tidigare okänd pil upptäcks medan pilarna dras ur (se
   * kommentaren vid `snapshots` nedan). Ska sättas in FÖRE den senast kastade
   * pilen i turordningen, inte sist.
   */
  onHiddenDartRevealed?: (tip: Point) => void,
  /** Anropas vid varje bekräftad, ren uttagning (ingen dold pil avslöjades). */
  onDartRemoved?: () => void,
  /** Loggar utförligt till konsolen. Styrs av ?debug i URL:en. */
  debug = false,
) => {
  // Callbacks i refs: annars byggs hela effekten om vid varje kast, eftersom
  // onDartDetected får ny identitet när poängen ändras. Det allokerade om alla
  // Mat:er, läste om baseline och avbröt rAF-loopen mitt i spelet.
  const onDartDetectedRef = useRef(onDartDetected);
  const onDebugStateRef = useRef(onDebugState);
  const onBoardClearedRef = useRef(onBoardCleared);
  const onHiddenDartRevealedRef = useRef(onHiddenDartRevealed);
  const onDartRemovedRef = useRef(onDartRemoved);
  const motionThresholdRef = useRef(motionThreshold);
  const debugRef = useRef(debug);
  useEffect(() => {
    onDartDetectedRef.current = onDartDetected;
    onDebugStateRef.current = onDebugState;
    onBoardClearedRef.current = onBoardCleared;
    onHiddenDartRevealedRef.current = onHiddenDartRevealed;
    onDartRemovedRef.current = onDartRemoved;
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
    // Diff mot NIVÅN UNDER toppen av `snapshots` - se kommentaren där.
    const baseDiff = new cv.Mat();
    const baseThresh = new cv.Mat();
    const emptyDiff = new cv.Mat();
    const emptyThresh = new cv.Mat();
    // Rådiff mot den TOMMA tavlan - underlaget för den positionsbaserade
    // avstämningen (dartCensus.ts). `emptyDiff`/`emptyThresh` ovan är den
    // WARPADE motsvarigheten och används till "tavlan tömd"-kollen.
    const censusDiff = new cv.Mat();
    const censusThresh = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    // Referensbilderna (warpad bild, motion-grinden). VIKTIGT: uppdatera dem
    // med `gray.copyTo(baseline)`, ALDRIG `baseline = gray.clone()`. I den här
    // OpenCV.js-byggen delar `Mat.clone()` databufferten med källan (verifierat:
    // klonens pixlar ändras när källan ändras) - så en klonad baseline blev i
    // praktiken samma bild som `gray`, `absdiff` gav alltid 0 och ingen pil
    // kunde detekteras. `copyTo` kopierar på riktigt. Samma regel gäller alla
    // Mat:er i `snapshots` nedan.
    const baseline = new cv.Mat();
    const previous = new cv.Mat();
    // Referensbild av den TOMMA tavlan (vid speluppstart). Långlivad - rör sig
    // bara vid den långsamma drift-uppdateringen längst ner. Används dels för
    // "är tavlan tom?"-kollen (spelarbyte), dels som säkerhetsnät: hittar den
    // stegvisa uttagningslogiken (se `snapshots`) på fel spår, tvingar den här
    // jämförelsen ändå fram en total återställning så fort tavlan verkligen är
    // tom, så bokföringen aldrig kan bli permanent fel.
    const emptyBaseline = new cv.Mat();

    // Stack av råbilder, en per pil som registrerats den här omgången (index 0
    // = tavlan tom). `snapshots[i]` = hur tavlan såg ut precis efter att den
    // i:e pilen registrerades (eller drogs ut/avslöjades - se nedan).
    //
    // Poängen: när pilarna dras ur känns en RIKTIG pil-i-taget-uttagning igen
    // på att bilden går TILLBAKA till ett tidigare snapshot i stacken, inte
    // fram mot ett nytt. Ett vanligt nytt kast går längre bort från toppen av
    // stacken (mer skiljer sig); en uttagning går närmare nivån UNDER toppen
    // (mindre skiljer sig). Två sammanslagna pilar (samma kontur, en spets -
    // känt problem, se CLAUDE.md) registreras bara som EN nivå här trots att
    // två pilar fysiskt sitter i tavlan. Dras den som syns (den som kastades
    // sist, alltså överst i stacken) ut och det fortfarande skiljer sig
    // ordentligt mot nivån under - då satt en till pil dold bakom den. Den
    // "avslöjas": vi letar pilform i det som skiljer sig mot den äldre
    // nivån och sätter in den som ett kast FÖRE den precis borttagna pilen
    // (se `onHiddenDartRevealed`, `insertThrow` i match.ts). Det här är
    // samma idé som konkurrenten Darteers instruktion "dra ut pilarna i
    // omvänd ordning" - se minnesanteckningen `correction-and-readout-wishlist`.
    let snapshots: any[] = [];
    const pushSnapshot = () => {
      const snap = new cv.Mat();
      rawGray.copyTo(snap);
      snapshots.push(snap);
    };
    const popSnapshot = () => {
      const snap = snapshots.pop();
      snap?.delete();
    };
    /**
     * Tar upp den aktuella bilden i toppnivån UTAN att ändra antalet pilar.
     * Körs när en förändring analyserats men inte var en pil (skugga, hand,
     * ljusskifte, förkastad blob). Gör man inte det ligger skräpet kvar i
     * diffen mot toppen för all framtid, och kan bli den största konturen
     * nästa gång en riktig pil ska hittas - då räknas skuggan som pil i
     * stället för pilen. Den gamla koden gjorde detta ovillkorligt efter
     * varje analys (`rawGray.copyTo(rawBaseline)`); med stacken måste det
     * göras explicit i varje gren som inte redan flyttar en nivå.
     */
    const absorbIntoTop = () => {
      if (snapshots.length > 0) rawGray.copyTo(snapshots[snapshots.length - 1]);
    };

    /**
     * ?debug&mask ritar ut SJÄLVA maskbilden (tröskad rådiff) på
     * vision-canvasen i stället för tavelöverlägget, och lämnar den kvar.
     * Utan att se masken går det inte att avgöra om ett tunt silverskaft
     * saknas helt, ligger i fragment eller finns men inte är största konturen
     * - och att gissa på det har kostat oss flera varv.
     */
    const maskMode =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('mask');

    /** Omskrivande rektangel för senast granskade blob, satt av findDartTip. */
    let lastBlobRect: { x: number; y: number; width: number; height: number } | null = null;

    /**
     * Absorberar BARA den förkastade blobbens område, inte hela bildrutan.
     *
     * Skälet: en förkastad blob (arm, skugga, ljusskifte) sitter oftast någon
     * helt annanstans i bilden än pilen. Absorberar man hela rutan sväljs
     * pilen med, och då finns den i referensen - den blir permanent osynlig
     * och kan aldrig registreras. Hände två gånger 2026-09-12: en arm nere
     * till vänster respektive ett ljusskifte förkastades, och den nyss
     * placerade pilen i bullen försvann i samma andetag (`baselineNoise` föll
     * till 0 med pilen kvar i tavlan).
     *
     * Radvis `set` på `.data` i stället för `roi()` + `copyTo`: i den här
     * OpenCV.js-byggen går det inte att lita på att en ROI skriver igenom
     * till föräldern (jfr clone()-fällan), och radkopiering är entydig.
     */
    const absorbBlobRegion = () => {
      const top = snapshots[snapshots.length - 1];
      if (!top) return;
      if (!lastBlobRect) {
        absorbIntoTop(); // ingen kontur att peka på - brusnivå, ta hela
        return;
      }
      const w = rawGray.cols;
      const x0 = Math.max(0, lastBlobRect.x);
      const y0 = Math.max(0, lastBlobRect.y);
      const x1 = Math.min(w, lastBlobRect.x + lastBlobRect.width);
      const y1 = Math.min(rawGray.rows, lastBlobRect.y + lastBlobRect.height);
      if (x1 <= x0 || y1 <= y0) return;
      const src = rawGray.data;
      const dst = top.data;
      for (let y = y0; y < y1; y++) {
        const off = y * w;
        dst.set(src.subarray(off + x0, off + x1), off + x0);
      }
    };
    const resetSnapshots = () => {
      snapshots.forEach((s) => s.delete());
      snapshots = [];
      pushSnapshot();
    };

    /**
     * Spetsarna i RÅ kamerakoordinater, i exakt samma ordning som
     * `detectedDartsRef.current` (som håller de warpade). Avstämningen i
     * `dartCensus.ts` jämför blobbar mot kända pilar, och blobbarna hittas i
     * råbilden - att warpa fram och tillbaka för varje jämförelse skulle bara
     * lägga till avrundningsfel. De två listorna MÅSTE ändras tillsammans.
     */
    let rawTips: Point[] = [];
    /**
     * Antal skilda pixlar mot den TOMMA tavlan vid förra analysen. Skillnaden
     * mellan två analyser säger om det blev MER eller MINDRE material i
     * tavlan - en oberoende riktningskontroll som avstämningen behöver, se
     * `MaterialDelta` i dartCensus.ts. -1 = ingen mätning gjord än.
     */
    let lastEmptyDiffPx = -1;
    const forgetDart = (index: number) => {
      rawTips.splice(index, 1);
      detectedDartsRef.current.splice(index, 1);
    };

    let rafId = 0;
    let stopped = false;
    let isStabilizing = false;
    let lastMotionTime = 0;
    let lastAnalysis: string | undefined;
    let lastLogTime = 0;
    let lastDebugEmit = 0;
    let lastEmittedState = '';
    let calmSince = 0; // hur länge scenen varit i stort sett orörd (för baseline-uppdatering)
    let grabDiag = ''; // diagnostiksträng från grabFrame
    let lastDiag = ''; // siffrorna bakom senaste blobbeslutet (?debug)
    let frameCount = 0;
    let lastRegisterTime = 0; // tidsspärr mot dubbeldetektering av samma pil

    // ~13 mm i den warpade bilden (2.3529 px/mm). Under det är "ny pil" troligen
    // samma pil igen.
    const MIN_DART_SPACING_PX = 30;

    // En spets som warpas till en radie långt utanför tavlan kan inte vara en
    // spets. Tavlan slutar vid 170 mm; en pil som verkligen sitter i
    // omgivningen läser 170-185 mm, så taket ligger över det. Uppmätt
    // 2026-09-12: en T6 lästes som MISS på radie 210 mm och en 10:a på 242 mm
    // - i båda fallen var blobben bara pilens VINGE, och en arm i bildkanten
    // gav 273-292 mm. Att registrera det som MISS är tyst fel: poängen blir 0
    // OCH pilräkningen stämmer ändå inte.
    const MAX_PLAUSIBLE_RADIUS_MM = 190;

    // Gråvärdesskillnad som räknas som "här har något ändrats" i RÅBILDEN.
    //
    // Var 15 (ärvt från POC:en). Sänkt till 10 efter mätning på Kristians tavla
    // 2026-09-12: hans pilar har SILVRIGT skaft och SVART vinge, och mot
    // tavlans gräddvita fält ligger silver-mot-vitt under 15 gråvärden. Då
    // föll skaftet bort ur masken och bara den svarta vingen blev kvar - en
    // kompakt blob (elong 1.0-1.1) vars tyngdpunkt sitter långt från spetsen.
    // Resultat: en 4:a lästes som T13 och en 10:a som MISS på radie 242 mm
    // (tavlan slutar vid 170). Syns skaftet blir blobben avlång i stället, och
    // då tar axelmetoden över - den läste conf 0.77 och rätt fält på den pil
    // där hela kroppen syntes.
    // 10, inte lägre. PROVAT 2026-09-12: tröskel 6 gjorde INTE skaftet synligt
    // (blobben blev fortfarande bara vingen, bbox 124x140, elong 1.6) men tog
    // antalet konturer i masken från 20-53 till 1778 och dTop från ~10 000 till
    // 188 000. Problemet med silverskaft över tavlans gräddvita fält är alltså
    // inte tröskeln - informationen finns i bilden men tappas någon annanstans
    // i kedjan (morfologi, blur eller gråskalekonverteringen). Sänk inte igen
    // utan att först titta på maskbilden: ?debug&mask ritar ut den.
    const RAW_DIFF_THRESHOLD = 10;

    // Uppstartsspärr: när spelet startar rör sig ofta användaren fortfarande i
    // bild (tryckte just på "Starta spel"). Referensbilden tas då med rörelse i,
    // och när scenen lugnar sig tolkas skillnaden som en pil. Ignorera all
    // avkänning de första 2 s.
    const startedAt = performance.now();
    const STARTUP_GRACE_MS = 2000;

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
      if (!ctx) {
        grabDiag = 'ctx=null';
        return;
      }
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      const frame = cv.imread(canvas);
      // Diagnostik: checksumma en bit av den råa bilden direkt efter drawImage,
      // så vi ser om nya videobildrutor faktiskt når hit.
      if (debugRef.current) {
        let s = 0;
        for (let i = 0; i < 4000 && i < frame.data.length; i += 4) s += frame.data[i];
        grabDiag = `frame ${frame.cols}x${frame.rows} rSum=${s}`;
      }
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
    gray.copyTo(baseline);
    gray.copyTo(previous);
    gray.copyTo(emptyBaseline);
    resetSnapshots();

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

    /**
     * Plockar ut (ny bild, referensbild)-par inuti en blobb, för skuggtestet.
     * Bara pixlar som faktiskt skiljer sig tas med - annars fylls urvalet av
     * oförändrad bakgrund inne i den avlånga blobbens omskrivande rektangel,
     * och allt ser ut som "samma yta, annat ljus".
     */
    const sampleBlob = (
      rect: { x: number; y: number; width: number; height: number },
      reference: any,
    ): BlobSample[] => {
      const x0 = Math.max(0, rect.x);
      const y0 = Math.max(0, rect.y);
      const x1 = Math.min(rawGray.cols, rect.x + rect.width);
      const y1 = Math.min(rawGray.rows, rect.y + rect.height);
      const stepX = Math.max(1, Math.floor((x1 - x0) / 60));
      const stepY = Math.max(1, Math.floor((y1 - y0) / 60));
      const samples: BlobSample[] = [];
      for (let y = y0; y < y1; y += stepY) {
        for (let x = x0; x < x1; x += stepX) {
          const cur = rawGray.ucharPtr(y, x)[0];
          const base = reference.ucharPtr(y, x)[0];
          if (Math.abs(cur - base) > RAW_DIFF_THRESHOLD) samples.push({ cur, base });
        }
      }
      return samples;
    };

    /**
     * Letar pilform i en tröskad diffbild (rawThresh eller baseThresh).
     * `reference` är bilden diffen räknades mot - behövs för skuggtestet.
     * Samma logik oavsett om diffen kom från ett nytt kast eller en
     * avslöjad dold pil - en pil ska klara samma krav i båda fallen.
     * Returnerar null + sätter `lastAnalysis` om inget dög.
     */
    const findDartTips = (
      threshMat: any,
      reference: any,
      frameArea: number,
      /** Hur många pilar som ska letas fram. 1 = första som duger (kastläget). */
      wanted = 1,
    ): TipFind[] => {
      if (maskMode && debugCanvasRef.current) {
        // FÖRE morfologin: visar vad tröskeln faktiskt gav. Data-URL:en läses
        // ut SYNKRONT direkt efteråt, för React återställer canvasens
        // width/height vid nästa rendering (JSX har width={800}) och suddar
        // det OpenCV ritat - canvasen var 800x800 och tom när vi försökte
        // hämta den i efterhand.
        try {
          cv.imshow(debugCanvasRef.current, threshMat);
          (window as any).__lastMask = debugCanvasRef.current.toDataURL('image/png');
          (window as any).__lastMaskAt = new Date().toISOString();
        } catch {
          /* diagnostik, inte kritisk */
        }
      }
      // PROVAT 2026-09-12 och backat: CLOSE före OPEN med 7x7-kärna, på
      // hypotesen att skaftet var fragmenterat (maskbilden visar att det
      // tonar bort mot spetsen). Det gav ingen förbättring - blobben blev
      // fortfarande bara vingen i felfallet - och tog antalet konturer från
      // 59-116 till 519-532. Orsaken visade sig vara en annan: skaftet är
      // inte fragmenterat utan HELT FRÅNVARANDE när det ligger över tavlans
      // ljusa fält, för silver mot gräddvitt har nästan ingen
      // luminanskontrast. Morfologi kan knyta ihop bitar men inte skapa det
      // som aldrig kom med i masken. Se CLAUDE.md om färgkontrast.
      cv.morphologyEx(threshMat, threshMat, cv.MORPH_OPEN, kernel);
      cv.morphologyEx(threshMat, threshMat, cv.MORPH_CLOSE, kernel);

      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(threshMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);

      // Arean är relativ bildstorleken nu (rå bild, inte den fasta 800x800:an).
      // maxArea sänkt till 2.5 %: riktiga kast från stativet mätte 7 000-18 000 px,
      // en arm/hand vid pilhämtning ~80 000 px och slank igenom det gamla 5 %-taket.
      const minArea = frameArea * 0.0002;
      const maxArea = frameArea * 0.025;

      // Kandidaterna prövas i storleksordning i stället för att bara den
      // STÖRSTA konturen får chansen. Skälet: är handen kvar i bild när
      // pilen landar - och det är den alltid när man handplacerar en pil -
      // så är armen större än pilen. Med bara största konturen förkastas
      // armen och pilen får aldrig prövas, trots att den ligger där som en
      // egen kontur i samma maskbild. Uppmätt 2026-09-12: tre försök i rad
      // med handplacerad pil i bullen gav bara armblobben nere i bildhörnet.
      // Fler kandidater när flera pilar ska hittas på en gång: tre pilar som
      // var och en fallit isär i pipa + vinge är sex fragment.
      const MAX_CANDIDATES = wanted > 1 ? 12 : 5;
      const candidates: { points: Point[]; area: number }[] = [];
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        if (area <= minArea || area >= maxArea) continue;
        const points: Point[] = [];
        for (let k = 0; k < contour.rows; k++) {
          points.push({ x: contour.data32S[k * 2], y: contour.data32S[k * 2 + 1] });
        }
        candidates.push({ points, area });
      }
      candidates.sort((a, b) => b.area - a.area);

      // Bitar av SAMMA pil sätts ihop innan de prövas. En pil blir inte
      // alltid en kontur: ligger det silvriga skaftet över ett gräddvitt
      // fält försvinner mellanstycket ur masken och pilen faller isär i
      // pipa + vinge. Vingen är störst, vann kandidatordningen, och dess
      // tyngdpunkt ligger ~40 mm från spetsen (uppmätt: 198 px fel, vilket
      // blev S18 där sanningen var 20). Ihopsatt blir felet 7 px. Se
      // blobGroups.ts och silverShaft.test.ts.
      const tried = groupFragments(candidates.slice(0, MAX_CANDIDATES));

      const results: TipFind[] = [];
      // Störste blobben inom areafönstret är den som absorberas om inget dög.
      lastBlobRect = tried.length ? boundingRect(tried[0].points) : null;

      if (contours.size() === 0) {
        lastAnalysis = `ingen kontur (diff för liten)`;
      } else if (tried.length === 0) {
        lastAnalysis = `ingen kontur i areafönstret ${minArea | 0}-${maxArea | 0} px (${contours.size()} konturer)`;
      } else {
        const rejected: string[] = [];
        for (const cand of tried) {
          const found = evaluateCandidate(
            cand.points,
            cand.area,
            reference,
            contours.size(),
            cand.members.length,
          );
          if (found) {
            results.push(found);
            if (results.length === 1) lastBlobRect = boundingRect(cand.points);
            if (results.length >= wanted) break;
            continue;
          }
          rejected.push(`${cand.area | 0}px: ${lastAnalysis ?? '?'}`);
        }
        if (results.length === 0) {
          lastAnalysis = `inget av ${tried.length} kandidater dög [${rejected.join(' | ')}]`;
        }
      }

      contours.delete();
      hierarchy.delete();
      return results;
    };

    /** Första kandidaten som duger. Kastlägets vanliga anrop. */
    const findDartTip = (threshMat: any, reference: any, frameArea: number): TipFind | null =>
      findDartTips(threshMat, reference, frameArea, 1)[0] ?? null;

    /**
     * Prövar EN kontur: skuggtest, formtest och rimlig radie. Returnerar
     * spetsen eller null (med skälet i `lastAnalysis`).
     */
    const evaluateCandidate = (
      points: Point[],
      bestArea: number,
      reference: any,
      nContours: number,
      nParts: number,
    ): TipFind | null => {
      let result: TipFind | null = null;
      {
        const bb = boundingRect(points);

        // Skuggtest FÖRE formtestet: en skugga kan mycket väl vara avlång och
        // klara både elongation och konfidens. Det som avslöjar den är att
        // tavlans eget mönster lyser igenom - se shadowTest.ts.
        const lighting = classifyShadow(sampleBlob(bb, reference));

        // Formkontroll: en pil är avlång. Runda blobbar är skuggor eller brus.
        // minAreaRect görs i JS (blobGroups.ts) i stället för via OpenCV: en
        // kandidat kan bestå av flera konturer efter grupperingen, och då
        // finns ingen enskild kontur att ge cv.minAreaRect. Att den är ren
        // TypeScript gör dessutom hela bedömningen körbar i testerna.
        const rect = minAreaRect(points);
        const long = Math.max(rect.width, rect.height);
        const short = Math.max(Math.min(rect.width, rect.height), 1);
        const elongation = long / short;

        // Själva beslutet - vilken metod att tro på, eller avstå - ligger i
        // `chooseDartTip` (ren funktion). Trösklarna där är framtrimmade mot
        // riktiga kast och låsta med regressionstester i
        // chooseDartTip.test.ts; här inne hade de inte gått att testa alls.
        let tipRaw: Point | null = null;
        let how = '';
        let axis: ReturnType<typeof detectDartAxisTip> = null;
        try {
          axis = lighting.isLightingOnly ? null : detectDartAxisTip(points, { minElongation: 2 });
          const choice = chooseDartTip({
            points,
            elongation,
            axis,
            isLightingOnly: lighting.isLightingOnly,
            lightingDecided: lighting.decided,
            lightingReason: lighting.reason,
          });
          tipRaw = choice.tip;
          how = choice.how;
        } catch (err) {
          console.error('Spetsdetektering misslyckades:', err);
          how = 'krasch i spetsdetektering';
        }

        // ?debug: siffrorna bakom beslutet. Viktigast är att BÅDA ändarna av
        // axeln poängsätts - läser appen "inte i närheten av rätt" är den
        // vanligaste orsaken att fenan valdes som spets, och då står rätt
        // poäng under `tail`.
        if (debugRef.current) {
          const at = (p: Point) => {
            const w = warpPoint(p);
            const s = getScoreFromPixel(w.x, w.y);
            const dx = (w.x - BOARD_PX / 2) * MM_PER_PX;
            const dy = (w.y - BOARD_PX / 2) * MM_PER_PX;
            const r = Math.hypot(dx, dy);
            // Riktningen med: ett SYSTEMATISKT kalibreringsfel förskjuter alla
            // kast samma väg, medan ett spetsdetekteringsfel sprider sig
            // slumpmässigt. Utan vinkeln går de två inte att skilja åt.
            const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
            return `${s.label}@${r.toFixed(0)}mm/${deg.toFixed(0)}°`;
          };
          // Blobbens mått avslöjar om HELA pilen kom med eller bara vingen:
          // en hel pil är ~200x60 px vid den här skalan, en ensam vinge
          // ~60x50.
          lastDiag =
            `area=${bestArea | 0} bbox=${bb.width}x${bb.height} kont=${nContours}` +
            // delar>1 = grupperingen satte ihop en pil som masken delat itu.
            (nParts > 1 ? ` delar=${nParts}` : '') +
            ` elong=${elongation.toFixed(1)}` +
            (axis
              ? ` axel(conf=${axis.confidence.toFixed(2)} elong=${axis.elongation.toFixed(1)}` +
                ` spets=${at(axis.tip)} fena=${at(axis.tail)} bredd ${axis.tipWidthPx.toFixed(1)}/${axis.tailWidthPx.toFixed(1)})`
              : ' axel=null') +
            ` skugga(r=${lighting.correlation.toFixed(2)} k=${lighting.slope.toFixed(2)}` +
            ` n=${lighting.sampleCount} ${lighting.isLightingOnly ? 'JA' : 'nej'})` +
            // Den punkt som faktiskt blev poängen, oavsett gren. Utan den går
            // det inte att felsöka tyngdpunktsgrenen - den saknar spets/fena.
            (tipRaw ? ` VALT=${at(tipRaw)} raw=${tipRaw.x | 0},${tipRaw.y | 0}` : ' VALT=-');
        }

        if (!tipRaw) {
          lastAnalysis = `blob OK (${bestArea | 0} px) men ${how}`;
        } else {
          // Rimlighetskoll på radien HÄR, inte vid registreringen: en kandidat
          // vars spets warpas utanför tavlan ska förkastas så att NÄSTA
          // kandidat får prövas. Låg kollen kvar i registerNewThrow spärrades
          // hela bildrutan av den största blobben (typiskt en arm), och pilen
          // bredvid fick aldrig chansen. Tavlan slutar vid 170 mm; en pil i
          // omgivningen läser 170-185, så taket ligger över det.
          const w = warpPoint(tipRaw);
          const radiusMM =
            Math.hypot(w.x - BOARD_PX / 2, w.y - BOARD_PX / 2) * MM_PER_PX;
          if (radiusMM > MAX_PLAUSIBLE_RADIUS_MM) {
            lastAnalysis = `spets på radie ${radiusMM | 0} mm, utanför tavlan (troligen arm eller bara vingen)`;
          } else {
            result = { tip: tipRaw, how, rect: bb };
          }
        }
      }

      return result;
    };

    /**
     * Sitter punkten så nära en redan registrerad pil att det troligen ÄR den?
     * Används både mot dubbelregistrering av ett kast och mot att en uttagen
     * pils "hål" (som har samma form och plats som pilen hade) tolkas som en
     * ny eller avslöjad pil.
     */
    const nearKnownDart = (tip: Point) =>
      detectedDartsRef.current.some(
        (d) => Math.hypot(d.x - tip.x, d.y - tip.y) < MIN_DART_SPACING_PX,
      );

    /**
     * Kastfasen: en ny pil hittad i diffen mot toppen av `snapshots`.
     * Oförändrad logik mot tidigare, bara flyttad hit.
     */
    const registerNewThrow = (found: TipFind) => {
      const tip = warpPoint(found.tip);

      // Dubbeldetektering: efter att en pil registrerats visade råbilden i
      // några bildrutor kvarvarande skillnad (pilen svänger in sig, fjädrar)
      // och samma pil räknades två gånger. Två spärrar:
      //  - tidsspärr: minst 1 s mellan registreringar.
      //  - platsspärr: ingen ny pil inom MIN_DART_SPACING_PX av en redan
      //    registrerad. Två pilar kan sitta tätt men aldrig i exakt samma
      //    punkt.
      const nowMs = performance.now();
      const tooSoon = nowMs - lastRegisterTime < 1000;

      // Radiekollen ligger i evaluateCandidate, så att en kandidat utanför
      // tavlan hoppas över och nästa får prövas.
      if (tooSoon) {
        lastAnalysis = `pil ignorerad (för snabbt efter förra, ${((nowMs - lastRegisterTime) / 1000).toFixed(1)} s)`;
        absorbBlobRegion();
      } else if (nearKnownDart(tip)) {
        lastAnalysis = `pil ignorerad (för nära en redan registrerad, samma pil eller dess hål?)`;
        absorbBlobRegion();
      } else {
        lastRegisterTime = nowMs;
        detectedDartsRef.current.push(tip);
        rawTips.push(found.tip);
        pushSnapshot();
        lastAnalysis = `PIL registrerad (${found.how})`;
        onDartDetectedRef.current(tip);
      }
    };

    /** En rad per analys när ?debug är på: vilken gren, med vilka siffror. */
    const logAnalysis = (branch: string, dTop: number, dBase: number) => {
      if (!debugRef.current) return;
      const base = dBase === Infinity ? '-' : `${dBase | 0}`;
      console.log(
        `[analyse] ${branch} dTop=${dTop | 0} dBase=${base} pilar=${snapshots.length - 1}` +
          (lastDiag ? `  ${lastDiag}` : '') +
          `  → ${lastAnalysis}`,
      );
    };

    /**
     * Räknar pilarna i tavlan i stället för att gissa av pixelmängder.
     *
     * Diffar råbilden mot den TOMMA tavlan (`snapshots[0]`), letar fram varje
     * pilformad blobb och stämmer av mot de spetsar vi redan registrerat. Se
     * dartCensus.ts för varför: `dBase < dTop` är nära ett myntkast när
     * pilarna är ungefär lika stora i bild, för absdiff är symmetriskt och
     * "en pil tillkom" ser likadant ut som "en pil försvann".
     *
     * Rör inte `lastAnalysis`/`lastBlobRect` - de hör till den gren som
     * faktiskt agerar.
     */
    const runCensus = (frameArea: number): { verdict: CensusVerdict; found: TipFind[] } => {
      const empty = snapshots[0];
      const savedAnalysis = lastAnalysis;
      const savedRect = lastBlobRect;
      let found: TipFind[] = [];
      let delta: MaterialDelta = 'unknown';
      try {
        cv.absdiff(rawGray, empty, censusDiff);
        cv.threshold(censusDiff, censusThresh, RAW_DIFF_THRESHOLD, 255, cv.THRESH_BINARY);
        // Riktningen mäts FÖRE findDartTips, som kör morfologi på masken.
        const emptyPx = cv.countNonZero(censusThresh);
        if (lastEmptyDiffPx >= 0) {
          // Samma areagolv som för en pilblob: mindre än så är brus, inte pil.
          const step = frameArea * 0.0002;
          if (emptyPx > lastEmptyDiffPx + step) delta = 'more';
          else if (emptyPx < lastEmptyDiffPx - step) delta = 'less';
        }
        lastEmptyDiffPx = emptyPx;
        // En mer än vi tror sitter där: annars kan ett nytt kast aldrig synas.
        found = findDartTips(censusThresh, empty, frameArea, rawTips.length + 1);
      } catch (err) {
        console.error('Avstämningen misslyckades:', err);
      } finally {
        lastAnalysis = savedAnalysis;
        lastBlobRect = savedRect;
      }
      const result = reconcileDarts({ known: rawTips, seen: found.map((f) => f.tip) });
      const verdict = interpretCensus(result, {
        knownCount: rawTips.length,
        // Hittades ingen blobb alls MEN vi tror att pilar sitter där, är det
        // analysen som inte gick att lita på - inte bevis för att tavlan är
        // tom. Den skillnaden är hela skälet till att `sawAnything` finns.
        sawAnything: found.length > 0 || rawTips.length === 0,
        materialDelta: delta,
      });
      return { verdict, found };
    };

    /**
     * Håller snapshot-stacken i takt med pilräkningen efter en avstämning.
     * Nivå 0 är alltid den tomma tavlan; toppen ska vara bilden som den ser ut
     * nu, annars diffar nästa analys mot ett läge som inte finns längre.
     */
    const syncSnapshots = () => {
      while (snapshots.length > rawTips.length + 1) popSnapshot();
      while (snapshots.length < rawTips.length + 1) pushSnapshot();
      // Nivå 0 är den TOMMA tavlan, och den är avstämningens enda fasta
      // referens. Skriv aldrig över den med en bildruta som kan innehålla en
      // hand eller en pil som inte känts igen - då skulle avstämningen tappa
      // sitt facit för resten av omgången.
      if (snapshots.length > 1) absorbIntoTop();
    };

    /**
     * Gör det avstämningen kom fram till. Returnerar false om beslutet inte
     * gick att genomföra - då får pixelheuristiken försöka i stället.
     */
    const actOnCensus = (
      verdict: CensusVerdict,
      seenDarts: TipFind[],
    ): boolean => {
      if (verdict.kind === 'oförändrat') {
        // Alla kända pilar syns, inget nytt hittades. Absorbera INTE hela
        // bildrutan här: har en pil landat utan att kännas igen som pilform
        // skulle den sväljas in i referensen och bli permanent osynlig (det
        // hände två gånger 2026-09-12 med den gamla helrute-absorptionen).
        // Låt i stället den gamla kastgrenen göra sitt - den absorberar bara
        // den förkastade blobbens yta. Uttagningsgrenen vetas av anroparen.
        return false;
      }

      if (verdict.kind === 'nytt kast') {
        const found = seenDarts[verdict.seenIndex];
        if (!found) return false;
        // Rektangeln måste följa med: avslås kastet av tidsspärren absorberar
        // registerNewThrow `lastBlobRect`, och den skulle annars peka på en
        // blobb från en tidigare analys.
        lastBlobRect = found.rect;
        registerNewThrow(found);
        return true;
      }

      if (verdict.kind === 'uttagning') {
        // Bakifrån, så indexen framför inte förskjuts under tiden.
        const idx = [...verdict.knownIndexes].sort((a, b) => b - a);
        for (const i of idx) forgetDart(i);
        syncSnapshots();
        lastAnalysis = `${idx.length} pil(ar) uttagna (avstämt), ${rawTips.length} kvar`;
        for (let k = 0; k < idx.length; k++) onDartRemovedRef.current?.();
        return true;
      }

      // 'osäker' hanteras av anroparen, som faller tillbaka på
      // pixelheuristiken - hit ska den aldrig komma.
      if (verdict.kind !== 'uttagning med dold pil') return false;

      // Uttagning som blottade en pil vi aldrig registrerat: den satt dold
      // bakom den som just drogs ut. Samma spärrar som den gamla grenen -
      // ett felaktigt insatt kast ändrar ställningen tyst, så hellre missa en
      // dold pil än hitta på en.
      const revealed = seenDarts[verdict.seenIndex];
      const idx = [...verdict.knownIndexes].sort((a, b) => b - a);
      for (const i of idx) forgetDart(i);

      const tip = revealed ? warpPoint(revealed.tip) : null;
      const outsideBoard =
        !!tip && Math.hypot(tip.x - BOARD_PX / 2, tip.y - BOARD_PX / 2) > BOARD_PX * 0.55;
      if (tip && !nearKnownDart(tip) && !outsideBoard) {
        detectedDartsRef.current.push(tip);
        rawTips.push(revealed!.tip);
        syncSnapshots();
        lastAnalysis = `DOLD PIL avslöjad vid uttagning (avstämt, ${revealed!.how})`;
        for (let k = 0; k < idx.length; k++) onDartRemovedRef.current?.();
        onHiddenDartRevealedRef.current?.(tip);
        return true;
      }

      syncSnapshots();
      const why = !tip ? 'ingen pilform' : outsideBoard ? 'utanför tavlan' : 'redan registrerad pil';
      lastAnalysis = `${idx.length} pil(ar) uttagna (avstämt), rest ignorerad (${why})`;
      for (let k = 0; k < idx.length; k++) onDartRemovedRef.current?.();
      return true;
    };

    /**
     * Något har ändrats sen förra stabila bilden. Avgör om det är ett nytt
     * kast (mer skiljer sig mot toppen av stacken) eller en uttagning
     * (mindre skiljer sig - närmare nivån under toppen). Se kommentaren vid
     * `snapshots`.
     */
    const analyseChange = () => {
      lastDiag = '';
      const frameArea = rawGray.rows * rawGray.cols || 1;
      const minArea = frameArea * 0.0002;
      // "Matchar tydligt, ingen verklig skillnad kvar" - samma tröskel som
      // gränsen för en för liten pilblob, återanvänd som brusnivå här.
      const CLEAR_MATCH = minArea;

      const top = snapshots[snapshots.length - 1];
      cv.absdiff(rawGray, top, rawDiff);
      cv.threshold(rawDiff, rawThresh, RAW_DIFF_THRESHOLD, 255, cv.THRESH_BINARY);
      const dTop = cv.countNonZero(rawThresh);

      let dBase = Infinity;
      const hasBelow = snapshots.length >= 2;
      const below = hasBelow ? snapshots[snapshots.length - 2] : null;
      if (below) {
        cv.absdiff(rawGray, below, baseDiff);
        cv.threshold(baseDiff, baseThresh, RAW_DIFF_THRESHOLD, 255, cv.THRESH_BINARY);
        dBase = cv.countNonZero(baseThresh);
      }

      // Avstämningen först: den vet VAR pilarna sitter och behöver inte gissa
      // ur pixelmängder. Pixelheuristiken nedan är kvar som fallback för de
      // fall avstämningen säger "vet inte" - typiskt när blobbanalysen inte
      // gick att köra.
      const { verdict, found: seenDarts } = runCensus(frameArea);
      if (verdict.kind !== 'osäker') {
        const acted = actOnCensus(verdict, seenDarts);
        if (acted) {
          logAnalysis(`AVSTÄMD/${verdict.kind}`, dTop, dBase);
          return;
        }
      }
      if (debugRef.current) {
        lastDiag = `${lastDiag} census=${verdict.kind}`.trim();
      }
      // Såg avstämningen alla kända pilar kan ingen ha tagits ut, hur
      // pixelmängderna än ser ut.
      const censusSawAllDarts = verdict.kind === 'oförändrat';

      // Går bilden NÄRMARE nivån under toppen än toppen själv - något drogs
      // ut, inte till. En pil som just kastats gör tvärtom: går längre bort
      // från toppen (mer material), aldrig närmare ett äldre snapshot.
      const removalLikely = hasBelow && dBase < dTop && !censusSawAllDarts;

      if (removalLikely && dBase < CLEAR_MATCH) {
        // Ren uttagning: toppilen drogs ut, ingenting nytt syns. En nivå ner.
        lastAnalysis = `pil uttagen (${snapshots.length - 2} kvar denna omgång)`;
        popSnapshot();
        forgetDart(detectedDartsRef.current.length - 1);
        onDartRemovedRef.current?.();
        logAnalysis('UTTAG', dTop, dBase);
        return;
      }

      if (removalLikely) {
        // Toppilen är borta, men skillnaden mot nivån under är för stor för
        // att vara brus - en pil satt dold bakom den. Leta pilform i det som
        // fortfarande skiljer sig mot den ÄLDRE nivån.
        const found = findDartTip(baseThresh, below, frameArea);
        const tip = found ? warpPoint(found.tip) : null;

        // Tre spärrar innan vi vågar sätta in ett kast i efterhand. Ett
        // felaktigt insatt kast ändrar ställningen tyst, så hellre missa en
        // dold pil än hitta på en:
        //  1. Ingen pilform alls i resten -> troligen skugga/ljusskifte.
        //  2. Spetsen ligger där en REDAN registrerad pil sitter. Då är det
        //     pilens eget hål vi ser (samma form, samma plats), eller en pil
        //     som dragits ut i annan ordning än sist-först. Hände i
        //     genomgången: dra ut pil 3, sedan pil 1 -> resten mot nivån
        //     under blev pil 1:s hål och hade registrerats en gång till.
        //  3. Spetsen ligger utanför tavlan. En dold pil sitter per
        //     definition bakom en annan pil, alltså i tavlan; en avlång
        //     fläck ute i väggen är något annat.
        const outsideBoard =
          !!tip && Math.hypot(tip.x - BOARD_PX / 2, tip.y - BOARD_PX / 2) > BOARD_PX * 0.55;

        if (tip && !nearKnownDart(tip) && !outsideBoard) {
          lastAnalysis = `DOLD PIL avslöjad vid uttagning (${found!.how})`;
          popSnapshot();
          pushSnapshot(); // nuvarande bild (den avslöjade pilen, ensam) blir nya toppen
          if (detectedDartsRef.current.length > 0) forgetDart(detectedDartsRef.current.length - 1);
          detectedDartsRef.current.push(tip);
          rawTips.push(found!.tip);
          onHiddenDartRevealedRef.current?.(tip);
        } else {
          // Osäkert. Säkraste antagandet är en ren uttagning - annars
          // riskerar vi att aldrig komma vidare mot tom tavla.
          // `emptyBaseline`-kollen längre ner fångar upp om det ändå blev fel.
          const why = !tip ? 'ingen pilform' : outsideBoard ? 'utanför tavlan' : 'redan registrerad pil';
          lastAnalysis = `pil uttagen, rest ignorerad (${dBase | 0} px, ${why})`;
          popSnapshot();
          forgetDart(detectedDartsRef.current.length - 1);
          onDartRemovedRef.current?.();
        }
        logAnalysis('UTTAG/DOLD', dTop, dBase);
        return;
      }

      // Vanligt nytt kast: mer material än toppen av stacken hade.
      const found = findDartTip(rawThresh, top, frameArea);
      if (found) registerNewThrow(found);
      else absorbBlobRegion(); // skugga/hand/ljusskifte - bara blobbens yta
      logAnalysis('KAST', dTop, dBase);
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

      // I maskläge äger findDartTip canvasen - skriv inte över masken.
      if (debugCanvasRef.current && !maskMode) cv.imshow(debugCanvasRef.current, warped);
    };

    const processFrame = () => {
      if (stopped) return;
      rafId = requestAnimationFrame(processFrame);

      if (videoElement.paused || videoElement.ended || videoElement.videoWidth === 0) return;

      frameCount++;
      grabFrame();

      cv.absdiff(gray, baseline, diff);
      cv.threshold(diff, thresh, 30, 255, cv.THRESH_BINARY);
      const baselineNoise = cv.countNonZero(thresh);

      cv.absdiff(gray, previous, diffPrev);
      cv.threshold(diffPrev, threshPrev, 30, 255, cv.THRESH_BINARY);
      const movementNoise = cv.countNonZero(threshPrev);

      gray.copyTo(previous);

      const now = performance.now();
      let state = 'STABLE';
      const dartsThisCycle = snapshots.length - 1;

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
          if (now - startedAt > STARTUP_GRACE_MS) {
            analyseChange();
          } else {
            lastAnalysis = 'hoppar över (uppstartsspärr)';
            absorbIntoTop(); // annars ligger uppstartsrörelsen kvar i diffen
          }
          gray.copyTo(baseline);
        } else {
          state = 'STABILIZING';
        }
      } else {
        isStabilizing = false;

        // Tavlan tömd? Jämför mot den tomma referensbilden. Är den nästan
        // identisk igen, och vi hunnit registrera minst en pil, så har någon
        // dragit ur pilarna -> spelarbyte. Säkerhetsnät oavsett vad den
        // stegvisa uttagningslogiken i analyseChange() kom fram till (se
        // kommentaren vid `snapshots`): tvingar alltid en total återställning
        // när tavlan verkligen är tom.
        if (dartsThisCycle > 0) {
          cv.absdiff(gray, emptyBaseline, emptyDiff);
          cv.threshold(emptyDiff, emptyThresh, 30, 255, cv.THRESH_BINARY);
          if (cv.countNonZero(emptyThresh) < 400) {
            detectedDartsRef.current = [];
            rawTips = [];
            lastEmptyDiffPx = -1;
            resetSnapshots();
            gray.copyTo(baseline);
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
            gray.copyTo(baseline);
            if (snapshots.length > 0) rawGray.copyTo(snapshots[snapshots.length - 1]);
            if (dartsThisCycle === 0) gray.copyTo(emptyBaseline);
            calmSince = now;
            if (debugRef.current) console.log('[det] baseline uppdaterad (drift)');
          }
        } else {
          calmSince = 0;
        }
      }

      if (debugRef.current && now - lastLogTime > 700) {
        const dt = now - lastLogTime;
        const fps = lastLogTime ? Math.round((frameCount / dt) * 1000) : 0;
        frameCount = 0;
        lastLogTime = now;
        // Checksumma en bit av gray + baseline: skiljer de sig ska baselineNoise
        // vara > 0. Är gray konstant är grabFrame frusen.
        let gs = 0;
        let bs = 0;
        for (let i = 200000; i < 210000 && i < gray.data.length; i++) gs += gray.data[i];
        for (let i = 200000; baseline && i < 210000 && i < baseline.data.length; i++) bs += baseline.data[i];
        // Rå diff mot toppen av pilstacken (samma referens som analyseChange
        // använder): ser råbilden pilen?
        const top = snapshots[snapshots.length - 1];
        cv.absdiff(rawGray, top, rawDiff);
        cv.threshold(rawDiff, rawThresh, RAW_DIFF_THRESHOLD, 255, cv.THRESH_BINARY);
        const rawNoise = cv.countNonZero(rawThresh);
        console.log(
          `[det] ${state}  baselineNoise=${baselineNoise}  movementNoise=${movementNoise}  rawNoise=${rawNoise}` +
            `  darts=${dartsThisCycle}  fps≈${fps}  grayΣ=${gs} baselineΣ=${bs}  ${grabDiag}` +
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
        rawGray, rawDiff, rawThresh, baseDiff, baseThresh, emptyDiff, emptyThresh,
        censusDiff, censusThresh,
        kernel, baseline, previous, emptyBaseline,
      ].forEach((m) => m?.delete());
      snapshots.forEach((m) => m?.delete());
    };
  }, [cv, videoElement, transformMatrix, isActive, debugCanvasRef]);
};
