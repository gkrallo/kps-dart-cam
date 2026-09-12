# CLAUDE.md — kps-dart-cam

Instruktioner och kontext för Claude Code i det här repot. Läs hela filen innan
du ändrar något i bildbehandlingen.

---

## Vad appen är

Automatisk poängräkning för dart via mobilkamera. Användaren ställer telefonen
på stativ framför darttavlan, kalibrerar en gång, och appen läser av var pilarna
träffar och räknar poängen automatiskt.

Ägare: Kristian (gkrallo). Appen är till för hemmabruk när han och vänner
spelar dart. Förebilden är DartsMind, som gör samma sak och fungerar bra.

**Slutmålet är husspelet "Farfar"**, men 301, 501 och Farfar finns alla som
spellägen. Regelmotorn (`src/game/`) är **portad från `kps-dart-scorecard`** och
bör hållas i synk med den - samma event-sourcade modell (en match sparar bara en
kastlista, ställningen räknas alltid fram, allt går att rätta i efterhand).

### Farfar-reglerna, enligt Kristian

Detta är ett lokalt husspel utan officiella regler. Beskrivningen kommer från
honom, inte från någon standard:

- Mål 15 i runda 1, +5 poäng per runda, runda 18 har mål 100.
- Röd bull (50) avslutar turen direkt och sparar de återstående pilarna.
  Grön 25 är bara poäng och sparar ingenting.
- Sparade pilar staplas utan tak: 3 grundpilar plus allt man sparat.
- Sista spelaren kvar vinner. Slås alla ut samma runda vinner den som hade högst
  poäng den rundan.
- Rundan spelas alltid färdigt innan utslagningen avgörs.
- Valfritt tak: matchen avgörs efter runda 18, och då vinner flest sparade pilar.

Konsekvens för datorseendet: Farfar kräver att **DB (50) skiljs från 25**, och
att sektorvärdet blir rätt eftersom man siktar på ett exakt målvärde. Ett fel på
en sektor förstör rundan.

---

## Grundprincip: ingen backend

Appen är en ren klientapp. **Ingen server, inga API-nycklar, inga externa
API-anrop, ingen telemetri.** Allt datorseende körs i webbläsaren via OpenCV.js
(WASM). Kamerabilder lämnar aldrig telefonen.

Detta är ett medvetet arkitekturbeslut, inte en tillfällighet — se
"Historik" nedan. **Introducera inte en backend utan att fråga Kristian först.**

Skälet är inte bara kostnad. Precision i datorseende kommer från att få upprepa
sig: lokalt kan kalibreringen medelvärdesbilda 30 bildrutor och köra hundratals
optimeringsiterationer gratis, medan ett API-anrop tar sekunder och kostar
pengar varje gång.

Vill vi ha "AI" senare ska det vara en modellfil som körs lokalt (ONNX Runtime
Web eller TensorFlow.js), inte ett moln-API. Lokal ML är förenligt med den här
principen; moln-ML är det inte.

---

## Stack

| | |
|---|---|
| Språk | TypeScript 5.8, `strict: true` |
| Ramverk | React 19 |
| Byggverktyg | Vite 6 |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite`, ingen `tailwind.config`) |
| Ikoner | lucide-react |
| Datorseende | OpenCV.js 4.12 via `@techstark/opencv-js`, självhostad |
| Test | Vitest 2 |
| Node | CI kör Node 20. Utvecklat mot Node 22. |
| Publicering | GitHub Pages via GitHub Actions |

Inga produktionsberoenden utöver React och lucide-react. OpenCV är en
devDependency vars `opencv.js` kopieras till `public/` vid bygge.

---

## Repostruktur

```
src/
  App.tsx                     Huvudkomponent. Kalibreringsflödet bor här.
  main.tsx                    Entry point
  types.ts                    Point, DartScore, TurnRecord
  index.css                   Tailwind-import + animationer

  components/
    CameraFeed.tsx            getUserMedia, videoelement, hårdvaruzoom
    CalibrationOverlay.tsx    SVG-överlägg med 4 dragbara punkter + wireframe
    GameSetup.tsx             Välj spelläge (301/501/Farfar) + spelare
    Scoreboard.tsx            Spelpanel (aktiv spelare, poäng, tur), detektorstatus
    ThrowEditor.tsx           Knappsats för att rätta en avläst pil
    TurnHistory.tsx           Turer bakåt: rätta, ta bort, lägga till missad pil
    HelpPanel.tsx             Hjälptexter (kalibrering, uttagning, rättning)
    RetrievalTip.tsx          Engångstips: dra ut pilarna i omvänd ordning

  hooks/
    useOpenCV.ts              Laddar opencv.js via modulnivå-promise
    useDartDetector.ts        rAF-loop: warp, bildsubtraktion, konturanalys, tavla-tömd
    useMatch.ts               React-omslag för spelmotorn (localStorage-persistens)

  game/                       Regelmotor, portad från kps-dart-scorecard
    types.ts                  Seg, MatchState, Match, MatchAction, Engine
    segments.ts               poäng, etikett, utgångsförslag
    x01.ts / farfar.ts        301/501 respektive Farfar
    match.ts                  event-sourcad match: throw/end/undo/remove/replace
    index.ts                  segFromDartScore (bryggan från datorseendet)

  utils/
    dartMath.ts               ★ Mått, koordinatsystem, poängberäkning
    homography.ts             DLT + Levenberg-Marquardt-lösare (N punkter, residual)
    boardProjection.ts        Homografi fram/bak, SVG-projektion, computeCalibration
    boardEllipse.ts           Ellipsanpassning + kalibrering ur ringellipser
    boardDetector.ts          Autodetektering: ellipsmetod + HoughCircles-fallback
    dartTip.ts                Spetsdetektering: axelanpassning (PCA) + breddtest
    shadowTest.ts             Skiljer "pil" från "samma yta, annat ljus" (skugga/reflex)
    calibration.ts            Sparad kalibrering (localStorage) + rotationsankare
    syntheticBoard.ts         Renderar exakt tavla + pil genom en känd kamera (test/felsökning)
    audioEngine.ts            Ljudeffekt (Web Audio) + svensk TTS
    __tests__/                Vitest

scripts/copy-opencv.mjs       Kopierar opencv.js från node_modules till public/
public/                       Ikoner, manifest. opencv.js hamnar här (gitignorerad)
.github/workflows/deploy.yml  Test → bygge → deploy till Pages
AGENT.md                      Arkitektur + lista över kända begränsningar
```

`dartMath.ts` är märkt med ★ för att den innehåller enda sanningskällan för
tavlans mått. Ändras något där ska testerna säga till.

---

## Installera, köra, testa

```bash
npm install
npm run dev      # Vite dev-server, http://localhost:5173
npm test         # 186 tester
npm run lint     # tsc --noEmit, strict
npm run build    # tsc --noEmit && vite build → dist/
```

`npm run opencv` kopierar `opencv.js` till `public/`. Det körs automatiskt som
del av `dev` och `build`, så det behövs sällan manuellt. Filen är gitignorerad
och ska inte checkas in — den är 10 MB och versionsstyrs via `package.json`.

### Kameran kräver HTTPS

`getUserMedia` fungerar bara över `https://` eller på `localhost`. Vill du testa
från telefonen på samma nät räcker inte `npm run dev -- --host`; du behöver ett
lokalt certifikat (`mkcert`) eller en tunnel. Att testa mot den publicerade
Pages-versionen är oftast enklast.

### Testa utan darttavla

Poänggeometrin är helt testbar utan kamera — det är ren matematik. Kör `npm test`.

`syntheticBoard.ts` renderar dessutom en geometriskt exakt tavla (samma `BOARD_MM`)
genom en känd pinhole-kamera, med valfri linsdistorsion och seedat brus, och
`projectDartSilhouette` projicerar en pil (3D-kropp) genom samma kamera. Det gör
**kalibrering, ellipsanpassning, spetsdetektering och hela poängkedjan** testbara
offline mot en känd sanning — se `homography.test.ts`, `boardEllipse.test.ts`,
`dartTip.test.ts`, `parallax.test.ts`.

`realBoard.test.ts` går ett steg längre: `__tests__/fixtures/outdoor-board.jpg`
är ett riktigt foto av Kristians slitna utomhustavla (kväll, en strålkastare,
snett sedd). Testet kör inte OpenCV men matar den rena geometrikedjan med
faktiska röd/grön-maskpixlar ur fotot — verklig optik, verklig tavla.

`game/__tests__/engine.test.ts` är regelmotorn (portad från scorecardens
`tools/test-engine.js`). `components/__tests__/gameViews.test.tsx` är ett
rök-test som renderar spelvyerna med `renderToStaticMarkup` (ingen DOM, men
fångar kraschar i renderträdet).

Kvar att verifiera på riktig hårdvara: OpenCV-delen (färgmask → kontur → ellips),
att pilmasken blir ren i verklig belysning, och hela spelflödet med detektering
(pil-ljud, uppläsning, automatiskt spelarbyte).

---

## Miljövariabler och API-nycklar

**Inga.** Appen behöver varken miljövariabler eller nycklar för att köra.

Enda variabeln som läses någonstans:

| Namn | Var | Syfte |
|---|---|---|
| `GITHUB_ACTIONS` | `vite.config.ts` | Sätts automatiskt av GitHub Actions. Styr `base`: `/kps-dart-cam/` i CI, `/` lokalt. Sätts aldrig manuellt. |

Om du någon gång inför en variabel: **prefixa aldrig en hemlighet med `VITE_`.**
Allt som heter `VITE_*` bäddas in i klientbundlen i klartext och är läsbart för
vem som helst som öppnar sidan.

---

## Bildbehandlingen

### Koordinatsystem — läs detta först

Detta är den viktigaste konventionen i kodbasen.

| Begrepp | Definition |
|---|---|
| Kanoniska koordinater | Millimeter. Bullseye i `(0, 0)`. Y växer **nedåt**, som i bildkoordinater. |
| Dubbelringens ytterkant | 170 mm. Hit sätts kalibreringspunkterna. |
| Warpad bild | 800 × 800 px. Radie 400 px = 170 mm. |
| Skala | `MM_PER_PX = 0.425`, `PX_PER_MM = 2.3529` |
| Vinkel | 0° rakt upp (sektor 20), positivt medurs. |

**Räkna aldrig poäng i pixlar.** Alla mått bor i `BOARD_MM` i `dartMath.ts` och
konverteras med `pixelToCanonical` / `canonicalToPixel`. Pixlar existerar bara i
gränssnittet mot OpenCV.

`BOARD_MM` är hämtat ur WDF/BDO-standarden och ska betraktas som fastställt:

```
innerBull    6.35   (DB, 50p)
outerBull   15.9    (25p)
tripleInner 99
tripleOuter 107
doubleInner 162
doubleOuter 170
```

### Kalibreringsflödet

1. Användaren drar fyra punkter till dubbelringens **ytterkant** vid sektor 20
   (topp), 6 (höger), 3 (botten) och 11 (vänster) — i den ordningen. Ordningen
   är hårdkodad överallt; ändra den inte utan att ändra på alla ställen.
2. `CalibrationOverlay` ritar samtidigt ett wireframe av tavlan projicerat genom
   `computeHomography`, så användaren ser om punkterna sitter rätt.

   **Wireframets form räcker inte som kontroll.** `autoDetectBoardEllipse`
   lägger punkterna vid *ellipsens* topp/höger/botten/vänster, men de ska
   ligga vid **mitten av 20:ans, 6:ans, 3:ans och 11:ans dubbelfält**. Det är
   samma sak bara om tavlan sitter med 20:an exakt rakt upp och kameran inte
   lutar i sidled. Sitter tavlan några grader snett hamnar alla fyra punkterna
   bredvid sina fält: ellipsen följer dubbelringen perfekt medan hela
   sektorhjulet är vridet och varje sektor läses fel. Uppmätt på Kristians
   tavla 2026-09-12. Döm därför av de **streckade sektorlinjerna mot tavlans
   riktiga trådar**. Rättas med "Peka ut 20:an"
   (`rotateCalibrationToAnchor`), som vrider hjulet till en godtycklig vinkel
   i *tavlans* plan - inte i bilden, för under perspektiv är det inte samma
   sak. (Den gjorde tidigare bara kvartssteg och var därmed oanvändbar mot
   det här felet.)
3. Vid "Starta spel" konverterar `App.tsx` skärmkoordinater till
   videokoordinater. Videon visas med `object-cover`, alltså skalad med
   `Math.max(cw/vw, ch/vh)` och centrerad — samma formel måste användas åt båda
   håll, annars glider kalibreringen.
4. `cv.getPerspectiveTransform` ger matrisen som mappar de fyra
   videokoordinaterna till `(400,0)`, `(800,400)`, `(400,800)`, `(0,400)`.

### Detekteringen

Triggern (att en pil landat och står still) körs i den **warpade** bilden:

```
kamera → warpPerspective(H) → gråskala → GaussianBlur
   → absdiff mot baseline / mot föregående ruta → tröskel → countNonZero
```

- **movementNoise** — mot föregående bildruta. Säger om något rör sig nu.
- **baselineNoise** — mot referensbilden. Säger om något tillkommit sedan sist.

En pil registreras när scenen är stilla (`movementNoise` under tröskeln) men
skiljer sig från baseline, och har varit så i 500 ms.

Spetsen hittas däremot i den **råa** (owarpade) bilden — se `dartTip.ts` och
fallgropen nedan:

```
rå gråskala → absdiff mot rå baseline → tröskel → morfologi → största konturen
   → detectDartAxisTip (PCA-axel + breddtest)  |  fallback: tyngdpunkt
   → perspectiveTransform(spets)  →  getScoreFromPixel  →  segFromDartScore
   →  useMatch.throwSeg  (+ pil-ljud, uppläst poäng)
```

Därefter sätts nya baselines (warpad + rå) så nästa pil syns som en ny skillnad.

**Tavla-tömd → spelarbyte.** En långlivad referensbild (`emptyBaseline`, den
tomma tavlan vid speluppstart) används som säkerhetsnät: när en stabil bildruta
är nästan identisk med den igen, och minst en pil hunnit registreras, tvingas
en total återställning fram oavsett vad den stegvisa uttagningslogiken (nedan)
kom fram till under vägs. För 301/501 avslutas turen (`endTurn`), en ton spelas
och nästa spelares namn läses upp. Farfar avslutar turen själv i motorn.

**Omvänd uttagning avslöjar dolda pilar (tillagt 2026-09-11).** `useDartDetector`
håller en STACK av rå-bilder (`snapshots`), en nivå per pil som registrerats
den här omgången (nivå 0 = tom tavla). Varje ny stabil bildruta jämförs mot
BÅDA de två översta nivåerna, inte bara toppen som tidigare:

```
diff mot toppen (dTop)       → mer skillnad = nytt kast, oförändrad logik
diff mot nivån under (dBase) → mindre skillnad än dTop = en pil drogs UR
```

`absdiff` är symmetriskt - den bryr sig inte om något tillkom eller försvann -
så en uttagning som inte hanteras särskilt skulle annars gå genom exakt samma
kod som ett nytt kast och riskera att registreras som ett spökkast (skillnaden
"pilhålet" ser ofta ut som en avlång blob, precis som en riktig pil). Genom att
jämföra mot BÅDA nivåerna kan koden skilja "mer material" (nytt kast) från
"mindre material" (uttagning) - och inom uttagning, skilja en REN uttagning
(bilden matchar nivån under nästan exakt) från en uttagning som avslöjar en
DOLD pil (bilden skiljer sig fortfarande, för att en till pil satt bakom den
just borttagna - känt problem, se "sammanslagna pilar" i listan nedan). I det
senare fallet körs samma formanalys (PCA-axel, elongation, konfidens) som för
ett vanligt kast, fast på resten-diffen mot den äldre nivån, och en ny
`onHiddenDartRevealed(tip)`-callback sätter in kastet på RÄTT plats i
kastlistan (`insertThrow` i `game/match.ts`) - före den pil som just drogs ut,
inte sist. `App.tsx` räknar ut var med en enkel räknare
(`removedSinceClearRef`, nollställd i `handleBoardCleared`) eftersom pilar
alltid dras i turordning (sist kastad ut först) - se `RetrievalTip`/`HelpPanel`
för hur det förklaras för spelaren. Idén är samma som konkurrenten Darteer.ai:s
instruktion "dra ut pilarna i omvänd ordning" - se minnesanteckningen
`correction-and-readout-wishlist`. Otestat på riktig hårdvara, se
[[pending-test-checklist]].

### Trösklar och parametrar — var ärlig om vad de är värda

**Nästan ingen av dessa är empiriskt intrimmad mot riktiga pilkast.** De flesta
är ärvda från AI Studio-POC:en utan känd härledning. Behandla dem som startvärden,
inte som resultat. Om du ändrar en, skriv i commit-meddelandet vad du mätte.

Sedan tabellen skrevs har vi verifierat mot riktig hårdvara (Kristians S25,
sep 2026) och justerat om raderna nedan som gäller `useDartDetector`. Se
[[dart-detection-status]]-minnet för fullständig historik.

| Parameter | Värde | Var | Ursprung |
|---|---|---|---|
| `motionThreshold` | 3000 | `App.tsx` | Ärvd från POC. Reglerbar i UI:t. Antal skilda pixlar av 640 000 i den warpade bilden. Handhållen kamera överskrider den konstant, därför krävs stativ. |
| Rörelsetröskel | 30 | `useDartDetector` | Ärvd. Gråvärdesskillnad för movement/baseline (warpad bild, `baselineNoise`/`movementNoise`). |
| Analyströskel | 10 | `useDartDetector` (`RAW_DIFF_THRESHOLD`) | **Uppmätt av oss** (sänkt från 15) 2026-09-12: Kristians pilar har silvrigt skaft och svart vinge, och silver mot tavlans gräddvita fält ligger under 15 gråvärden. Då föll skaftet ur masken och bara vingen blev kvar - en kompakt blob vars tyngdpunkt gav fel fält (en 4:a lästes som T13). Vid 10 kom hela pilen med i 2 av 3 kast. Kostnad: fler konturer i masken (38 → 491), men med belysningsring föll det till 11. |
| `baselineNoise` | > 500 | `useDartDetector` | Ärvd. Gränsen för "något har tillkommit" som gör att STABILIZING→ANALYZING triggas. |
| Stabiliseringstid | 500 ms | `useDartDetector` | Ärvd. Rimlig — en pil landar och står still. |
| Uppstartsspärr | 2000 ms | `useDartDetector` (`STARTUP_GRACE_MS`) | **Tillagd av oss**, uppmätt: användaren rör sig ofta fortfarande i bild direkt efter "Starta spel", och den skillnaden tolkades som en pil. |
| Baseline-drift | 15 s helt orörd, `baselineNoise` < 120 & `movementNoise` < 200 | `useDartDetector` | **Justerad av oss** (från 4 s) - för snabb ätit en pil som ännu inte hunnit analyseras. |
| Konturarea (rå bild) | 0,02–2,5 % av bildytan | `useDartDetector` (`minArea`/`maxArea`) | **Uppmätt av oss**: riktiga kast från stativet mätte 7 000–19 000 px i en 1080×1920-bild (≈0,3–1 %). maxArea sänkt från 5 % → 2,5 % sedan en arm vid pilhämtning (~80 000 px) annars räknades som pil. |
| Skuggtest: korrelation | ≥ 0,75 | `shadowTest.ts` | **Satt av oss**, verifierat mot syntetiska skuggor över en renderad tavla (`shadowTest.test.ts`), ej mot hårdvara. En skugga låter tavlans mönster lysa igenom (`cur ≈ k · base`), en pil ersätter ytan och korrelationen kollapsar. |
| Skuggtest: lutning | 0,15–0,95 (och > 1,05 = reflex) | `shadowTest.ts` | **Satt av oss.** Under 0,15 är ytan nästan svart oavsett underlag = föremål, inte skugga. 0,95–1,05 är ingen ljusändring värd namnet. |
| Skuggtest: minsta underlagsstruktur | sd ≥ 6 gråvärden | `shadowTest.ts` | **Satt av oss.** Enfärgat underlag ger inget mönster att korrelera mot - då svarar testet "vet inte" och pilen behålls. Säkra riktningen. |
| Konfidenstak (axelmetoden) | > 0,33 | `dartTip.ts` (`MIN_AXIS_CONFIDENCE`) | **Uppmätt av oss.** Var 0,15, höjdes till 0,4 (riktiga kast 0,55–0,75, artefakter 0,20–0,23), sänktes till 0,33 den 2026-09-12: en kraftigt lutad pil i bullen mätte **0,43** och låg alltså under det tidigare intervallet, medan dagens artefakter (arm i bildkanten) låg på 0,09–0,23. Gapet går numera mellan 0,23 och 0,43. |
| `elongation`, axelmetoden | 2–12 | `useDartDetector` (`MAX_ELONGATION`) | Nedre gräns (2) ärvd. Övre gräns (12) **tillagd av oss**, uppmätt: en spindeltråd/tavelkant/skuggrand mätte 24:1, riktiga kast 2,6–4,4. |
| `elongation`, tyngdpunktsmetoden (frontal pil) | ≤ 3 (utan golv om skuggtestet frikänt blobben) | `dartTip.ts` (`MAX_CENTROID_ELONGATION`) | **Uppmätt av oss.** Taket var 5: dagens artefakter låg på elong 3,3, 3,8 och 4,3 med konfidens 0,09–0,15 och släpptes alltså igenom som "frontal pil" - de räddades bara av radiespärren. Tyngdpunkten är dessutom garanterat fel i en lång blob; den sitter mitt på pilkroppen. Golvet var 2,5 utifrån en gissning att en frontal pil mäter 2,5–4; uppmätt gav tre raka kast 1,2/1,4/1,6, så golvet är borta men kräver att skuggtestet aktivt frikänt blobben. |
| Kandidater per analys | 5 största inom areafönstret | `useDartDetector` (`MAX_CANDIDATES`) | **Uppmätt av oss** 2026-09-12. Förut prövades bara den STÖRSTA konturen. Är handen kvar i bild - alltid vid handplacering, ofta när en pil just landat - är armen större än pilen, så armen valdes, förkastades, och pilen bredvid fick aldrig prövas. |
| Rimlig spetsradie | ≤ 190 mm | `useDartDetector` (`MAX_PLAUSIBLE_RADIUS_MM`) | **Uppmätt av oss.** Tavlan slutar vid 170 mm; en pil i omgivningen läser 170–185. Uppmätt bortom det: vingar på 210 och 242 mm, armar på 273–292 mm. Att registrera sådant som MISS är tyst fel i både poäng och pilräkning. |
| Dubbeldetekterings-spärr | 1000 ms **och** 30 px (~13 mm) från senast registrerade pil | `useDartDetector` (`MIN_DART_SPACING_PX`) | **Tillagd av oss**: samma pil registrerades om medan den svängde in sig efter landning. |
| Texturtröskel | stddev < 38 | `boardDetector` | Ärvd. Ska sålla bort släta ytor (väggar, tyg) vid tavledetektering. |
| HoughCircles | dp=1, minDist=minRadius, param1=100, param2=30 | `boardDetector` | Ärvd. param2=30 är lågt och ger många falska cirklar. |
| Radieintervall | 0.12–0.45 × min(bredd,höjd) | `boardDetector` | Ärvd (maxRadius höjd från 0.40). |
| Cirkelpoäng | `texture/100 + sizeBonus*2 - centerPenalty` | `boardDetector` | **Påhittad av oss** för att sluta välja cirkeln närmast bildmitten. Vikterna är gissade. |
| Punktvalidering | 0.5–1.5 × medianavstånd | `boardDetector` | **Satt av oss**, avsiktligt tillåtande för att inte förkasta sneda kameravinklar. |
| Morfologikärna | ellips 3×3 | `useDartDetector` | Satt av oss. Minsta rimliga. |
| Blur | Gauss 5×5 | `useDartDetector` | Ärvd storlek, men flyttad till rätt plats i kedjan. |
| Ring-färgmask (HSV) | röd H<13 ∪ H>167, grön H 36–92, S≥55–70, V≥45–55 | `boardDetector` | **Satt av oss.** Tillåtande — bekräftat mot fotot i `realBoard.test.ts` att röd/grön-masken plockar ut ringarna även på en sliten tavla i skugga. Kan behöva justeras för din belysning. |
| Ellipsval | fyrkantighet ≥ 0.55, centrum inom 0.42 × min(bild) | `boardDetector` | **Satt av oss.** Fotot visade att rödbrunt trädäck matchar "röd" bättre än den slitna ringen — "största konturen" låste på däcket. En ring är rund och nära bildmitten; däck och pilfenor är avlånga fläckar i kanten. |

Verifierat exakt offline: `BOARD_MM`, koordinatkonverteringarna, homografilösaren,
ellipsgeometrin, spetsdetekteringen och regelmotorn — 186 tester, delvis mot den syntetiska
tavlan. Verifierat på riktig hårdvara (sep 2026): hela kedjan (kamera → warp →
absdiff → kontur → spets → poäng) upptäcker och läser av pilar korrekt i
normalzonen, med den återstående bull-precisionsfrågan ovan.

---

## Konventioner

**Språk.** Kommentarer, commit-meddelanden och UI-text på svenska. Kod —
variabler, funktioner, typer — på engelska. Testbeskrivningar på svenska.

**Kommentarer förklarar varför, inte vad.** Där koden ser konstig ut ska
kommentaren säga vilket problem den löser. Flera sådana finns redan; ta inte
bort dem vid refaktorering.

**Mått i millimeter.** Se koordinatsystemet ovan.

**Felhantering.** Fel som användaren kan åtgärda visas i UI:t (kameraåtkomst,
OpenCV som inte laddar). Interna fel loggas med `console.error` och appen
fortsätter köra hellre än kraschar — under ett dartspel är en tappad bildruta
bättre än en vit skärm. `try/finally` används genomgående där OpenCV-Mat:er
allokeras.

**OpenCV-minne.** Varje `new cv.Mat()` och `.roi()` måste `.delete()`:as.
WASM-heapen städas inte av garbage collectorn. Allokera utanför rAF-loopen och
radera i effektens cleanup. Detta har läckt förut.

**Använd aldrig `cv.Mat.prototype.clone()`.** I den här OpenCV.js-byggen
(`@techstark/opencv-js`) delar `.clone()` databufferten med källan i stället
för att kopiera — verifierat direkt på enheten. Det var i flera veckor
orsaken till att *ingen* pil detekterades: referensbilderna i
`useDartDetector` sattes med `baseline = gray.clone()`, blev alias för `gray`,
och `absdiff` jämförde bilden med sig själv. Allokera målet en gång
(`new cv.Mat()`) och uppdatera med `src.copyTo(dst)`, som kopierar på riktigt.

**Tester.** All ren matematik ska ha test. `dartMath.test.ts` testar
poänggeometrin; `pipeline.test.ts` kör hela kedjan genom en simulerad snedställd
kamera. Lägg till fall där, inte nya testfiler, om det handlar om geometri.

**strict mode.** `strict`, `noUnusedLocals`, `noUnusedParameters` är på. `any`
är tillåtet enbart för OpenCV-objekt, som saknar typer.

---

## Fallgropar och medvetna avsteg

Saker som ser fel ut men är avsiktliga. Ändra dem inte utan att läsa varför.

**Ingen CSS-transform för zoom.** `CameraFeed` gör bara hårdvaruzoom via
`applyConstraints`. Tidigare fanns *både* hårdvaruzoom och
`transform: scale(zoomLevel)`, medan koordinatmatematiken bara kompenserade för
den ena — resultatet blev dubbel zoom och en felaktig homografi på varje telefon
som stödjer zoom-constraint. Zoomreglaget visas därför bara om kameran faktiskt
rapporterar zoom-capability. Lägg inte tillbaka CSS-zoom: digital zoom beskär
bara bilden utan att tillföra en enda pixel.

**`validateDartboardPoints` förkastar men rättar inte.** Föregångaren
`sanitizeDartboardPoints` speglade punkter genom bullseye för att tvinga fram
symmetri. Det förstörde perspektivinformationen: en tavla sedd snett *ska* vara
osymmetrisk, och speglingen gjorde fyrhörningen till ett parallellogram så
homografin blev affin. Det finns ett test som vaktar detta.

**Spetsen hittas i RÅ bild, triggern i warpad.** `useDartDetector` håller två
baselines (`baseline` warpad, `rawBaseline` rå) och två absdiff-kedjor. Det ser
redundant ut men är avsiktligt: i den warpade bilden är pilkroppen utsmetad
eftersom den sticker ut ur tavlans plan, så axeln man anpassar där är inte
pilens axel. Bara den färdiga spetspunkten warpas (`cv.perspectiveTransform`).
Se `parallax.test.ts` för varför det spelar roll (6+ mm fel annars).

**Callbacks ligger i refs, inte i dependency-arrayen.** `useDartDetector` tar
emot `onDartDetected` men lägger den i en ref och utesluter den ur `useEffect`.
Det ser ut som en glömd dependency men är avsiktligt: callbacken får ny identitet
vid varje kast (den beror på poängen), och hade den legat i arrayen skulle hela
detektorn rivas och byggas om mitt i spelet.

**`getScoreFromCanonicalCoordinates` finns även om `getScoreFromPixel` används.**
Den förstnämnda är den riktiga funktionen; den andra är bara ett omslag. Skriv
nya anrop mot mm-varianten där det går.

**Homografin löses i ren JS, inte via OpenCV.** `homography.ts` gör DLT +
Levenberg-Marquardt för hand (Jacobi-egenvärden, egen linjär lösare). Skälet:
`computeHomography` körs i React-render för att rita kalibrerings-wireframet, där
OpenCV inte behöver vara laddat, och allt används i tester som körs i Node utan
WASM. `App.tsx` använder däremot `cv.getPerspectiveTransform` för själva warpen —
det är den enda platsen homografin går genom OpenCV.

**Vision View och miniatyren delar samma canvas-ref.** Bara en av dem är
monterad åt gången (`viewMode`), så det fungerar — men det är skört. Om båda
någon gång renderas samtidigt kommer bara en att få ref:en.

**`opencv.js` laddas som `<script>`, inte som import.** OpenCV.js är en
emscripten-modul som exponerar sig på `window.cv` på tre olika sätt beroende på
build. `useOpenCV` hanterar alla tre. Att importera npm-paketet direkt in i
bundlen skulle lägga 10 MB i huvudchunken.

**Ingen service worker ännu.** Appen har manifest och ikoner och kan installeras,
men cachas inte offline. `opencv.js` är 10 MB och behöver precachas medvetet.

---

## Historik: repot kom från en POC i Google AI Studio

Ursprunget var en proof of concept genererad i Google AI Studio, som synkade mot
det här GitHub-repot. Det förklarar flera saker i koden:

- **Ärvda magiska tal.** Se tabellen ovan. Många trösklar har ingen känd
  härledning; de var i koden från början.
- **Död kod var normen.** Flera välskrivna funktioner var aldrig inkopplade —
  `computeInverseHomography`, `getScoreFromCanonicalCoordinates`. Ironiskt nog
  var den bortkopplade koden ofta den bättre versionen. `audioEngine` (ljud +
  svensk TTS) är numera helt inkopplad: pil-ljud + uppläst poäng vid detektering,
  fanfar vid vinst, "Nästa spelare"-ton + uppläst namn vid spelarbyte. Om du
  hittar mer oanvänd kod: koppla in den eller radera den, låt den inte ligga.
- **En backend som inte gick att köra.** POC:en hade en Express-server med en
  Gemini-proxy. `dotenv` importerades aldrig, så `.env` lästes inte; `PORT` var
  hårdkodad; `NODE_ENV` sattes aldrig. Allt är borttaget.
- **Ringradierna var systematiskt fel.** Poängen räknades i hårdkodade pixlar
  som inte matchade kalibreringens skala — 6,4 mm av dubbelringens 8 mm
  klassades som MISS. Det var huvudorsaken till "säger oftast fel poäng".
  Rättat och testtäckt.

AI Studio har **inte längre** åtkomst till repot. Det finns ingen synk att ta
hänsyn till.

---

## Vad som inte fungerar bra ännu

Se `AGENT.md` för detaljer och planerad lösning. Kort. (Uppdaterat sep 2026
efter de första riktiga testomgångarna på Kristians tavla — se
[[dart-detection-status]].)

1. **Bull-precision — LÖST 2026-09-12, men bara verifierad med handplacerade
   pilar.** Var den stora blockeraren: en röd bull lästes som `25@13mm`.
   Efter omkalibrering (rotationen rättad för hand), belysningsring runt
   tavlan och sänkt analyströskel läser samma pil `DB@2mm`. Experimentet som
   avgjorde saken: samma pil mitt i DB med vingen vänd olika håll gav
   `DB@2mm/19°` respektive `DB@6mm/193°` - alltså är spetsdetekteringen inte
   riktningsberoende, och DB skiljs från 25 som Farfar kräver. De 13 mm var
   inte en principiell gräns utan gammal kalibrering plus dåligt ljus.
   **Kvar att verifiera:** bullträffar från riktiga KAST (inte handplacerade),
   och gränsfallet 25 nära en sektorgräns som var det ursprungliga felet.
2. **Uttagning av pilar** hanteras nu stegvis (se "Omvänd uttagning avslöjar
   dolda pilar" ovan) i stället för att bara känna igen hela-tavlan-tömd - en
   pil som satt dold bakom en annan kan avslöjas och sättas in i efterhand när
   pilarna dras i omvänd ordning. **Otestat på riktig hårdvara.** Kristians
   ursprungsidé (dra ut fel pil, håll handen ur bild ≥2 s, sätt tillbaka för
   att läsa om just den positionen) är fortfarande inte byggd - kvarstår som
   fallback om den nya logiken inte räcker till, eller för att rätta en pil
   som lästes fel utan att vara dold.
3. **Sammanslagna pilar** blir fortfarande en kontur och ger en spets NÄR de
   kastas (oförändrat) - men om de går isär till två synliga pilar vid
   uttagning fångas den andra nu upp där (se punkt 2). Tre eller fler pilar
   sammanslagna i en enda kontur är fortfarande inte hanterat. Missas en pil
   helt säger appen till vid turslut ("bara 2 av 3 pilar avlästa", både på
   skärmen och uppläst) och den går att fylla i via `TurnHistory`.
4. **Skuggor** förkastas nu av `shadowTest.ts` när underlaget har struktur att
   korrelera mot. Ligger fläcken mitt i ett enfärgat fält svarar testet "vet
   inte" och släpper igenom den - då är det bara form- och konfidenstesterna
   som gäller, som förut.
5. **Add-vs-remove-heuristiken** (`dBase < dTop` i `useDartDetector`) är en
   ren pixelräkning. När pilarna är ungefär lika stora i bild är den nära ett
   myntkast, och en dold pil hittas då inte alls (ingen felaktig ställning -
   bara utebliven rättning). Den robusta lösningen är positionsbaserad
   avstämning: håll en RÅ referens av tom tavla, hitta alla pilformade
   konturer mot den och matcha mot kända spetsar - omatchad blob = oregistrerad
   pil, känd spets utan blob = uttagen pil. Inte byggt.
6. **Parallax** (mätt): en kamera räcker bara med spetsdetektering i råbilden
   (finns nu) eller två kameror. Ett kvarvarande fel på några mm är oundvikligt
   med en kamera när pilen lutar mycket.
7. **`?debug`-instrumenteringen** i `useDartDetector.ts` (fps, gray/baseline-
   checksummor, `grabDiag`) är kvar från felsökningen av clone()-buggen. Ta
   bort när bull-precisionen är löst och inga fler djupdykningar behövs.

Nästa planerade steg: bull-precision (auto-kalibrera), positionsbaserad
avstämning (punkt 5), tap-to-correct i Vision View.
