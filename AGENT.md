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
tools/                         adb + CDP-verktyg för felsökning mot telefonen
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

## Jämförelse mot marknaden (2026-09-13)

Kristian lät tre AI:er researcha hur andra kamerabaserade darträknare löser
felhantering, och sammanställde det till en brief med nio förslag. Nedan är
bedömningen mot vår kod. Den är dokumenterad för att slippa göra om den, och
för att flera av förslagen visade sig vara lösta hos oss på annat sätt.

**Referenserna** som var värda något: Autodarts Lens (Winmau, sep 2026, den
bäst dokumenterade enkameralösningen), Scolia (flerkamera, men tydlig
turlogik), och DeepDarts-artikeln (Waterloo, CVSports 2021) som är det enda
hårda siffermaterialet: 94,7 % rätt totalpoäng rakt framifrån, 84,0 % vid
varierande kameravinkel. Deras felanalys stämmer med vår: vanligast är missad
detektion på grund av skymning, näst vanligast är pilar på segmentkant.

Det finns ingen oberoende jämförelse där samma telefon, ljus och kastserie
körts genom flera appar. Jaga inte någon annans siffra.

### Redan löst hos oss - stryk

| Förslag | Var |
|---|---|
| Hand i bild som eget tillstånd | Rörelse ger `MOTION` och ingen analys; analys bara på stilla bild i 500 ms; `maxArea` 2,5 % tar armblobbar; skuggtestet finns |
| Stabilitetsfönster före låsning | 500 ms stillastående + 1 s mellan registreringar + 30 px platsspärr + 2 s uppstartsspärr |
| Röstuppläsning av poäng | `audioEngine`, inklusive felfallen ("bara 2 av 3 pilar avlästa", "ingen pil avläst") |
| Rättning flera turer bakåt | `TurnHistory`, 12 turer över spelare och rundor |
| Växla spelare trots olöst pil | Växlar alltid vid tomt bräde; gul banner med "Lägg till" ligger kvar |
| Uttag som turgräns | Gäller 301/501. **Inte** Farfar - se nedan |

Principen briefen mäter mot - *automatisera flödet, aldrig bekräftelsen* -
följer vi redan. Enda modalen är uppstartskortet, som ligger utanför spelet.

### Farfar: briefen har rätt i problemet, fel i lösningen

Förslaget var att flytta turgränsen från pilantal till uttag, eftersom en
Farfar-tur kan vara 1-7 pilar. Men i Farfar är pilantalet **inte bara en
gräns - det är en del av poängen**: `savedDarts = available - thrown`. Att
avsluta turen på uttag utan att veta hur många pilar som kastades flyttar bara
felet från "turen hänger sig" till "fel antal sparade pilar", vilket är
tystare och värre.

Signalen som faktiskt löser det finns redan: `dartCensus.ts` räknar hur många
pilformade blobbar som fysiskt sitter i tavlan, oberoende av hur många som
gick att LÄSA. Ser den tre men bara två är registrerade vet vi att en pil
missades även om vi inte kan läsa den. Det gör om "turen hänger sig" till
"turen är slut, en pil okänd, fyll i".

Bygg det INTE som en tyst nolla i kastlistan - rätt pilräkning men fel poäng
är precis den sortens tysta fel vi undviker på alla andra ställen. Turen ska
avslutas med uppläst varning och gul banner.

### Confidence-nivåer: rätt idé, fel signal

Förslaget var tre nivåer i stället för binärt. Vi har en confidence (0-1) men
den är **inte kalibrerad för ett mellanläge**: uppmätt ligger riktiga kast på
0,55-0,80 och artefakter på 0,09-0,23. Gapet är brett och nästan tomt, så ett
"medel"-band på den signalen skulle sällan träffa något.

Den signal som är exakt, gratis och träffar precis det DeepDarts pekar ut som
näst vanligaste felet är **avståndet i millimeter till närmaste sektorgräns**.
Ren geometri vi redan räknar. En pil 1 mm från T20/S20-tråden är osäker
oavsett vad detektorn tycker om sin egen blobb, och det är just den pilen som
kostar 40 poäng.

Samma sak gäller DB mot grön 25: briefen föreslog "extra marginal" mellan dem.
Det går inte - gränsen är 6,35 mm ur `BOARD_MM`, och att flytta den vore att
införa ett systematiskt fel. Det rätta är att flagga osäkerhet NÄRA gränsen,
aldrig att flytta gränsen.

### Korrigeringslogg: det som är värt mest, och en hake

Varje rättning användaren gör är ett färdigetiketterat testfall, och den
snabbaste vägen till att kunna mäta om en ändring hjälpte. Additivt, billigt,
och inget lämnar telefonen - vilket arkitekturprincipen kräver ändå.

Haken: ett kast lagras som `{ t: 'T', v, m }` utan proveniens, så en rättning
vet i dag inte vad detektorn SÅG. Det behövs en sidotabell från kastindex till
detektionsdata (area, bbox, elongation, konfidens, avstämningens utfall,
spetsposition). Allt är redan uträknat - bara inte sparat.

### Ordningen i turen: värd mer hos oss än hos referensapparna

Sedan 2026-09-13 sätts en avslöjad pil in sist i turen som en GISSNING. I
301/501 spelar det sällan roll; i Farfar kan en felplacerad röd bull ändra
utfallet. Drag-och-släpp avråds - pilar upp/ner per kast i `TurnHistory` är en
bråkdel av jobbet och fungerar bättre med tummen.

### Ordning att ta det i

1. **Testa det vi har först.** Flera av förslagen ovan är åtgärder mot fel vi
   ännu inte sett i verkligheten.
2. Korrigeringsloggen, direkt efter testsessionen medan felen är färska.
3. Farfar-räkningen via census - men bara om testet visar att turer faktiskt
   hänger sig.
4. Osäkerhetsflagga på sektormarginal.
5. Pilar upp/ner i `TurnHistory`.

### Förkastat, och varför

- **Gester framför kameran** (hand över bullen = ångra): krockar med att man
  sträcker sig in mot tavlan för att hämta pilar.
- **Röststyrning**: mikrofontillstånd, svensk igenkänning och ett rum med prat
  och musik blir en ny felkälla, inte färre tryck.
- **Att rutinmässigt lära ut att dra ur pilar mitt i turen** för att avslöja
  skymda: skapar tvetydiga händelser. Vår uttagningslogik ska vara en riktad
  åtgärd när något saknas, inte ett generellt beteende.
- **Att jaga en publicerad träffsäkerhetssiffra**: det finns ingen oberoende
  mätning att jämföra mot.

Ej utvärderat men noterat: en Bluetooth-fjärr eller smartklocka för "nästa
runda" och "ångra". Klarar bara binära handlingar, inte vilket segment - så
komplement, aldrig ersättning.

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
4. ~~Rätta kast flera turer bakåt~~ — **gjort.** `TurnHistory` ("Turer" i
   bottenraden) visar de 12 senaste turerna, över både spelare och rundor, och
   låter en rätta, ta bort och lägga in en missad pil på rätt plats.
   Ställningen räknas om ur kastlistan. Det som återstår är att flytta ett
   kast inom turen utan att ta bort och lägga in igen - se punkt 9 och
   bedömningen av punkt I nedan.
5. Hantering av felaktig tavla-tömd-detektering (hand kvar i bild, dålig ljus).
5b. Verifiera mot riktiga kast: fragmentgrupperingen (`blobGroups.ts`),
   avstämningen (`dartCensus.ts`) och den automatiska sektorrotationen
   (`sectorPhase.ts`). Alla tre är mätta offline mot riktiga foton och mot
   syntetiskt facit, ingen av dem mot ett kast.
6. Låt warpen i `App.tsx` gå genom `computeCalibration` (N grovt utpekade
   punkter) i stället för `cv.getPerspectiveTransform` på exakt fyra.
7. Service worker för fullt offline-läge (opencv.js är 10 MB och bör precachas).
8. Lokal ML (DeepDarts-liknande keypoint-modell).
9. Turordning: om en pil missas men nästa läses hamnar kasten fel i listan,
   och en pil som avslöjas vid uttagning sätts in sist i turen som en
   GISSNING (`insertIndexForRevealedThrow`). Spelar roll för Farfar, där en
   felplacerad röd bull ändrar utfallet, och för 301/501-utgång. Billigaste
   åtgärden är pilar upp/ner per kast i `TurnHistory` - se punkt I nedan.

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
