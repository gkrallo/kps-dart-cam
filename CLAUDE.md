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

**Slutmålet är husspelet "Farfar"**, inte 501. 501 finns bara som första
spelläge för att kunna testa datorseendet. Farfar-motorn ska på sikt delas med
Kristians andra repo `kps-dart-scorecard`, som redan implementerar reglerna.

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
    Scoreboard.tsx            501-panel, detektorstatus, Vision-miniatyr

  hooks/
    useOpenCV.ts              Laddar opencv.js via modulnivå-promise
    useDartDetector.ts        rAF-loop: warp, bildsubtraktion, konturanalys
    useDartGame.ts            501-regelmotor (bust, double-out, undo)

  utils/
    dartMath.ts               ★ Mått, koordinatsystem, poängberäkning
    homography.ts             DLT + Levenberg-Marquardt-lösare (N punkter, residual)
    boardProjection.ts        Homografi fram/bak, SVG-projektion, computeCalibration
    boardEllipse.ts           Ellipsanpassning + kalibrering ur ringellipser
    boardDetector.ts          Autodetektering: ellipsmetod + HoughCircles-fallback
    syntheticBoard.ts         Renderar en exakt tavla genom en känd kamera (test/felsökning)
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
npm test         # 125 tester
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
genom en känd pinhole-kamera, med valfri linsdistorsion och seedat brus. Det gör
**kalibrering, ellipsanpassning och hela poängkedjan** testbara offline mot en känd
sanning — se `homography.test.ts`, `syntheticBoard.test.ts` och kalibreringsfallen
i `pipeline.test.ts`. Kvar att verifiera mot en riktig tavla: verkliga pilblobbar,
verklig linsoptik, och pilens parallax (den sticker ut ur tavlans plan).

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
3. Vid "Starta spel" konverterar `App.tsx` skärmkoordinater till
   videokoordinater. Videon visas med `object-cover`, alltså skalad med
   `Math.max(cw/vw, ch/vh)` och centrerad — samma formel måste användas åt båda
   håll, annars glider kalibreringen.
4. `cv.getPerspectiveTransform` ger matrisen som mappar de fyra
   videokoordinaterna till `(400,0)`, `(800,400)`, `(400,800)`, `(0,400)`.

### Detekteringen

```
kamera → warpPerspective(H) → gråskala → GaussianBlur
   → absdiff mot baseline → tröskel → morfologi (open, close)
   → största konturen → formkontroll → spetspunkt
   → pixelToCanonical → getScoreFromCanonicalCoordinates → useDartGame
```

Två separata skillnadsmått körs varje bildruta:

- **movementNoise** — mot föregående bildruta. Säger om något rör sig nu.
- **baselineNoise** — mot referensbilden. Säger om något tillkommit sedan sist.

En pil registreras när scenen är stilla (`movementNoise` under tröskeln) men
skiljer sig från baseline, och har varit så i 500 ms. Därefter sätts en ny
baseline så nästa pil syns som en ny skillnad.

### Trösklar och parametrar — var ärlig om vad de är värda

**Nästan ingen av dessa är empiriskt intrimmad mot riktiga pilkast.** De flesta
är ärvda från AI Studio-POC:en utan känd härledning. Behandla dem som startvärden,
inte som resultat. Om du ändrar en, skriv i commit-meddelandet vad du mätte.

| Parameter | Värde | Var | Ursprung |
|---|---|---|---|
| `motionThreshold` | 3000 | `App.tsx` | Ärvd från POC. Reglerbar i UI:t. Antal skilda pixlar av 640 000 i den warpade bilden. Handhållen kamera överskrider den konstant, därför krävs stativ. |
| Rörelsetröskel | 30 | `useDartDetector` | Ärvd. Gråvärdesskillnad för movement/baseline. |
| Analyströkel | 15 | `useDartDetector` | Ärvd. Lägre för att fånga hela pilens form vid analys. |
| `baselineNoise` | > 500 | `useDartDetector` | Ärvd. Gränsen för "något har tillkommit". |
| Stabiliseringstid | 500 ms | `useDartDetector` | Ärvd. Rimlig — en pil landar och står still. |
| Konturarea | 100–15000 | `useDartDetector` | Ärvd. Godtyckliga tal i warpade pixlar. Borde vara relativa mått. |
| `elongation` | ≥ 2.5 | `useDartDetector` | **Tillagd av oss**, resonerad inte mätt: en pil är avlång, en skugga är rund. Inte kalibrerad mot verkliga kast. |
| Texturtröskel | stddev < 38 | `boardDetector` | Ärvd. Ska sålla bort släta ytor (väggar, tyg) vid tavledetektering. |
| HoughCircles | dp=1, minDist=minRadius, param1=100, param2=30 | `boardDetector` | Ärvd. param2=30 är lågt och ger många falska cirklar. |
| Radieintervall | 0.12–0.45 × min(bredd,höjd) | `boardDetector` | Ärvd (maxRadius höjd från 0.40). |
| Cirkelpoäng | `texture/100 + sizeBonus*2 - centerPenalty` | `boardDetector` | **Påhittad av oss** för att sluta välja cirkeln närmast bildmitten. Vikterna är gissade. |
| Punktvalidering | 0.5–1.5 × medianavstånd | `boardDetector` | **Satt av oss**, avsiktligt tillåtande för att inte förkasta sneda kameravinklar. |
| Morfologikärna | ellips 3×3 | `useDartDetector` | Satt av oss. Minsta rimliga. |
| Blur | Gauss 5×5 | `useDartDetector` | Ärvd storlek, men flyttad till rätt plats i kedjan. |
| Ring-färgmask (HSV) | röd H<12 ∪ H>168, grön H 36–92, S≥60–80, V≥45–60 | `boardDetector` | **Satt av oss** för `autoDetectBoardEllipse`. Inte intrimmad mot en riktig tavla i verklig belysning. |
| Trippelring-matchning | 0.45–0.8 × dubbelringen, centrum inom 0.25× | `boardDetector` | **Satt av oss.** Geometrin (`boardEllipse.ts`) är testad; det som är otestat är att hitta rätt kontur. |

Verifierat exakt: `BOARD_MM`, koordinatkonverteringarna, homografilösaren och
ellipsgeometrin — 125 tester, delvis mot den syntetiska tavlan.

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

**OpenCV-minne.** Varje `new cv.Mat()`, `.clone()` och `.roi()` måste
`.delete()`:as. WASM-heapen städas inte av garbage collectorn. Allokera utanför
rAF-loopen och radera i effektens cleanup. Detta har läckt förut.

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
  `audioEngine` (90 rader ljud och TTS som aldrig spelades),
  `computeInverseHomography`, `getScoreFromCanonicalCoordinates`. Ironiskt nog
  var den bortkopplade koden ofta den bättre versionen. Om du hittar mer
  oanvänd kod: koppla in den eller radera den, låt den inte ligga.
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

Se `AGENT.md` för detaljer och planerad lösning. Kort:

1. **Pilspetsen** hittas som "punkten på konturen närmast tavlans mitt". Det
   plockar fel punkt när pilen ligger på tvären eller sitter nära bullen.
   Ska ersättas av axelanpassning (`fitLine` + breddtest för att avgöra vilken
   ände som är spetsen), utförd i **rå kamerabild** — inte i den warpade, där
   pilkroppen är utsmetad eftersom den sticker ut ur tavlans plan.
2. **Uttagning av pilar** ger spökkast. `absdiff` är ett absolutbelopp och kan
   inte skilja "något dök upp" från "något försvann".
3. **Automatisk kalibrering** antar cirkel (tavlan är en ellips sedd snett) och
   kan inte avgöra rotationen. Tavlans färgmönster är periodiskt — roterar man
   två sektorer ser den likadan ut — så färger och trådar ger sektorgränser men
   aldrig vilken sektor som är 20. Planen är sparat engångsankare från
   användaren.
4. **Sammanslagna pilar** blir en kontur och ger en spets.

Nästa planerade steg är punkt 1.
