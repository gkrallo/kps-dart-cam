# Arkitektur: KPs DartCam

Levande dokumentation. Uppdatera den när arkitekturen ändras.

## Princip

Ren klientapp. React SPA byggd med Vite, all bildbehandling i webbläsaren via
OpenCV.js (WASM). **Ingen backend, inga API-nycklar, inga externa anrop.** Vill
du lägga till "AI" senare ska det vara en modellfil som körs lokalt (ONNX
Runtime Web / TF.js), inte ett moln-API.

Skälet är inte bara kostnad: precision i datorseende kommer från att få
upprepa sig. Lokalt kan kalibreringen medelvärdesbilda 30 bildrutor och köra 200
optimeringsiterationer gratis. Genom ett API har du råd med ett anrop.

## Filstruktur

```
src/
  App.tsx                      Huvudkomponent, kalibreringsflöde, layout
  types.ts                     Point, DartScore, TurnRecord
  components/
    CameraFeed.tsx             Kameraström + hårdvaruzoom
    CalibrationOverlay.tsx     SVG-överlägg med de 4 dragbara punkterna
    GameSetup.tsx              Val av spelläge + spelare
    Scoreboard.tsx             Spelpanel, detektorstatus, Vision-miniatyr
    ThrowEditor.tsx            Rätta en avläst pil
  hooks/
    useOpenCV.ts               Laddar opencv.js (modulnivå-promise)
    useDartDetector.ts         rAF-loop: warp, bildsubtraktion, konturanalys, tavla-tömd
    useMatch.ts                React-omslag för spelmotorn (localStorage)
  game/                        Regelmotor portad från kps-dart-scorecard
    segments.ts x01.ts farfar.ts match.ts types.ts index.ts
  utils/
    dartMath.ts                ★ Mått, koordinatsystem, poängberäkning
    homography.ts              DLT + Levenberg-Marquardt (N punkter, reprojektionsresidual)
    boardProjection.ts         Homografi fram och bak, SVG-projektion, computeCalibration
    boardEllipse.ts            Ellipsanpassning + kalibrering ur ringellipser
    boardDetector.ts           Autodetektering: ellipsmetod + HoughCircles-fallback
    dartTip.ts                 Spetsdetektering: axelanpassning + breddtest
    blobGroups.ts              Sätter ihop maskfragment som hör till samma pil
    dartCensus.ts              Avstämning: vilka pilar sitter faktiskt i tavlan
    sectorPhase.ts             Rotationen ur röd/grön-växlingen i ringarna
    shadowTest.ts              Skiljer pil från skugga/reflex
    calibration.ts             Sparad kalibrering (localStorage) + rotationsankare
    syntheticBoard.ts          Exakt tavla + pil renderad genom en känd kamera (offline-testning)
    audioEngine.ts             Ljudeffekt + svensk TTS
    __tests__/                 Vitest
scripts/copy-opencv.mjs        Kopierar opencv.js från npm till public/
.github/workflows/deploy.yml   Test + bygge + deploy till GitHub Pages
```

## Koordinatsystem

Se README. Kort: **allt räknas i millimeter med bullseye i origo.** Pixlar
existerar bara i gränssnittet mot OpenCV, och konverteras direkt via
`pixelToCanonical` / `canonicalToPixel`. `BOARD_MM` är enda sanningskällan för
tavlans mått.

## Dataflöde

```
kamera → warpPerspective(H) → gråskala → absdiff mot baseline   (triggern)
   → tröskel → morfologi → konturer (i RÅ bild)
   → groupFragments (bitar av samma pil sätts ihop, blobGroups.ts)
   → kandidater i storleksordning → spetspunkt (dartTip.ts)
   → warpPoint → getScoreFromPixel → segFromDartScore → useMatch.throwSeg
   + avstämning mot TOM tavla (dartCensus.ts): kast, uttagning eller dold pil
   + tavla-tömd-detektering → endTurn / spelarbyte + ljud/TTS
```

## Kända begränsningar

Ärlig lista över vad som inte är bra ännu.

### Pilspetsen (`dartTip.ts`, `useDartDetector.ts`)
`detectDartAxisTip` anpassar pilens axel med PCA, projicerar maskpunkterna på
axeln för att hitta ändarna, och avgör vilken som är spetsen genom att mäta
bredden vinkelrätt mot axeln (fenan är ~4× bredare). `useDartDetector` kör detta
på maskpunkter från **rå kamerabild** — i den warpade är pilkroppen utsmetad
eftersom den sticker ut ur planet — och warpar sedan bara den färdiga spetsen
genom homografin.

Fallback för en nästan frontal pil (rund blob, ingen tillförlitlig axel):
blobbens tyngdpunkt. Parallaxen är liten när pilen pekar mot linsen, så det
duger. Kvar att verifiera mot en riktig tavla: att färgsegmenteringen/masken
faktiskt ger en ren pilkontur i verklig belysning.

### Uttagning av pilar
`absdiff` är ett absolutbelopp och kan inte skilja "något dök upp" från "något
försvann". När pilarna dras ur registreras spökkast. Behöver riktad subtraktion
eller ett explicit "tavla rensad"-läge.

### Kalibrering
`computeCalibration` (`boardProjection.ts` + `homography.ts`) är en överbestämd
lösare: DLT-startgissning, sedan Levenberg-Marquardt som minimerar
reprojektionsfelet, och den returnerar en residual i px. Den tar N ≥ 4 par.
`App.tsx` använder fortfarande `cv.getPerspectiveTransform` på exakt fyra punkter
för själva warpen — nästa steg är att låta även warpen gå genom `computeCalibration`
med fler, grovt utpekade punkter (kräver riktig tavla för att verifiera).

`boardEllipse.ts` + `autoDetectBoardEllipse` är den nya autodetekteringen:
`fitEllipse` (Sampson-omviktad) på dubbel- och trippelringens färgmask →
`calibrationFromRingEllipses` som iterativt återställer perspektivet. Två
koncentriska ringar med kända radier (170/107 mm) pinnar
perspektivförkortningen; radiellt fel < 1 mm även vid brant kameravinkel
(verifierat i `boardEllipse.test.ts`). `HoughCircles` finns kvar som fallback.

**Rotationen** kan inte bestämmas av ringarna (de är rotationssymmetriska), men
väl av färgerna PÅ dem: dubbel- och trippelringen växlar röd/grön varje sektor,
och sektor 20 är en mörk sektor med röd ring. `sectorPhase.ts` passar in
fyrkantsvågens fas och ger vridningen. Mönstret är periodiskt med 36°, så det
finns tio lika bra lösningar — `orientToImageUp` ("20 i toppen") väljer bland
dem, och det som förut var några graders fel blir noll. Mätt på ett riktigt
foto: -2,50°, mot -2,34° från en helt oberoende metod (luminansgradienten
längs radien, alltså trådarna). Körs i `autoDetectBoardEllipse` och via knappen
"Rikta in sektorer" (`alignSectorsToBoard`). Går färgerna inte att läsa finns
`orientCalibrationToward(calib, punkt)` / `rotateCalibrationToAnchor`
("Peka ut 20:an") kvar. Hela kalibreringen sparas i `localStorage`.

Ett riktigt foto (`__tests__/fixtures/outdoor-board.jpg`) visade att röd/grön-
masken plockar ut ringarna bra även på en sliten tavla i skugga — men att det
rödbruna trädäcket matchar "röd" bättre än ringen, så "största konturen" i
`autoDetectBoardEllipse` låste på däcket. Åtgärdat: konturer filtreras nu på
fyrkantighet och närhet till bildmitten. OpenCV-delen är dock fortfarande bara
verifierad via Python-simulering, inte på riktig hårdvara.

### Sammanslagna pilar
Två pilar som sitter ihop ger fortfarande en kontur och en spets NÄR de kastas.
Går de isär vid uttagning fångas den andra upp av avstämningen (`dartCensus.ts`)
och sätts in på rätt plats i turen. Tre eller fler i en enda kontur är inte
hanterat.

En pil kan också falla isär i FLERA konturer — ligger det silvriga skaftet över
ett gräddvitt fält saknar mellanstycket kontrast och försvinner ur masken.
`groupFragments` (`blobGroups.ts`) sätter ihop dem igen; villkoret är att
unionen blir mer avlång, så en skugga bredvid pilen inte slås ihop med den.

## Att göra

1. ~~Verifiera hela flödet på riktig tavla~~ — **gjort sep 2026.** Detektering,
   pilmask och spelflöde (pil-ljud, uppläsning, spelarbyte) fungerar live.
   ~~Kvarstående delfråga: bull-precision~~ — **löst sep 2026** med
   omkalibrering, belysningsring och sänkt analyströskel: samma pil gick från
   `25 @ 13 mm` till `DB @ 2 mm`. Kvar att verifiera: bullträffar från riktiga
   KAST (inte handplacerade) och en grön 25 nära en sektorgräns.
2. Enskild pil-korrigering: dra ut fel pil, håll handen ur bild ≥2 s, sätt
   tillbaka på en tydlig plats — appen läser om just den positionen.
   (Kristians idé, ospikat.) Bygger vidare på `emptyBaseline`-logiken men per
   pil, inte hela tavlan.
3. Tap-to-correct direkt i Vision View (nu finns bara `ThrowEditor` via
   pilrutorna i panelen). Ger även märkt data för framtida ML.
4. Rätta kast **flera turer bakåt** (motorn stödjer det, `removeThrow` /
   `replaceThrow`; UI:t rättar bara aktuell tur).
5. Hantering av felaktig tavla-tömd-detektering (hand kvar i bild, dålig ljus).
5b. Verifiera mot riktiga kast: fragmentgrupperingen (`blobGroups.ts`),
   avstämningen (`dartCensus.ts`) och den automatiska sektorrotationen
   (`sectorPhase.ts`). Alla tre är mätta offline mot riktiga foton och mot
   syntetiskt facit, ingen av dem mot ett kast.
6. Låt warpen i `App.tsx` gå genom `computeCalibration` (N grovt utpekade
   punkter) i stället för `cv.getPerspectiveTransform` på exakt fyra.
7. Service worker för fullt offline-läge (opencv.js är 10 MB och bör precachas).
8. Lokal ML (DeepDarts-liknande keypoint-modell).
9. Turordning: om en pil missas men nästa läses hamnar kasten fel i listan.
   Spelar roll för Farfar och 301/501-utgång. Ospikat hur det ska upptäckas
   eller rättas.

Klart och verifierat offline: homografilösaren, ellipskalibreringen,
spetsdetekteringen, parallaxmätningen, rotationsankaret, sparad kalibrering,
fragmentgrupperingen, avstämningen, sektorrotationen ur färgerna,
**regelmotorn (301/501/Farfar) + rättning**. Parallax: en kamera räcker bara med
spetsdetektering i råbilden eller två kameror. Klart och verifierat på riktig
hårdvara: hela detekteringskedjan, pil-ljud, uppläsning per pil **och per
avslutad tur** (summa + ny ställning, se `audioEngine.speak`), automatiskt
spelarbyte.

## Fallgropar

- **`cv.Mat.prototype.clone()` delar databufferten med källan i den här
  OpenCV.js-byggen (`@techstark/opencv-js`) — kopierar INTE.** Detta var
  orsaken till att ingen pil detekterades alls i flera veckor: referensbilderna
  i `useDartDetector` sattes med `baseline = gray.clone()`, som bara blev ett
  alias för `gray`, så `absdiff` jämförde bilden med sig själv och gav alltid
  0. Verifierat direkt på enheten (`a.setTo(99)` ändrade även en tidigare
  tagen `b = a.clone()`, samma `byteOffset`). **Använd aldrig `.clone()` här —
  allokera målet en gång (`new cv.Mat()`) och uppdatera med `src.copyTo(dst)`,
  som kopierar på riktigt.**
- **OpenCV.js Mat:er städas inte av garbage collectorn.** Varje `new cv.Mat()`
  och `.roi()` måste `.delete()`:as. Allokera utanför rAF-loopen.
- **Callbacks från React i refs**, inte i effektens dependencies — annars byggs
  detektorn om vid varje kast.
- **Aldrig både hårdvaruzoom och CSS-transform.** Det gav dubbel zoom och en
  felaktig homografi. Nu används bara hårdvaruzoom, och reglaget visas bara om
  kameran stödjer det.
- **Rimlighetskontroller får förkasta, inte "rätta".** En tavla sedd snett ska
  vara osymmetrisk; tvingar man fram symmetri förstörs perspektivet.
