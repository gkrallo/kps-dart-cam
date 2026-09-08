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
    Scoreboard.tsx             501-panel, detektorstatus, Vision-miniatyr
  hooks/
    useOpenCV.ts               Laddar opencv.js (modulnivå-promise)
    useDartDetector.ts         rAF-loop: warp, bildsubtraktion, konturanalys
    useDartGame.ts             501-regelmotor
  utils/
    dartMath.ts                ★ Mått, koordinatsystem, poängberäkning
    homography.ts              DLT + Levenberg-Marquardt (N punkter, reprojektionsresidual)
    boardProjection.ts         Homografi fram och bak, SVG-projektion, computeCalibration
    boardDetector.ts           Automatisk tavledetektering (HoughCircles)
    syntheticBoard.ts          Exakt tavla renderad genom en känd kamera (offline-testning)
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
kamera → warpPerspective(H) → gråskala → absdiff mot baseline
   → tröskel → morfologi → största konturen → spetspunkt
   → pixelToCanonical → getScoreFromCanonicalCoordinates → useDartGame
```

## Kända begränsningar

Ärlig lista över vad som inte är bra ännu.

### Pilspetsen (`useDartDetector.ts`)
Använder "punkten på konturen närmast tavlans mitt". Det håller bara när pilen
pekar rakt utåt från centrum. Ligger pilen på tvären, eller sitter den nära
bullen, plockas en punkt på skaftet eller fjädern.

Två fel ska rättas samtidigt:
1. **Ingen axel.** Ska bli: `fitLine` på maskpixlarna → projicera → de två
   extremerna är pilens ändar → avgör vilken som är spetsen genom att mäta
   bredden vinkelrätt mot axeln (fjädern är 2–3× bredare).
2. **Fel bild.** Analysen görs i den *warpade* bilden. Homografin gäller bara
   för punkter i tavlans plan, och pilkroppen sticker ut 10–15 cm — den warpade
   pilen är en strimma vars riktning inte är pilens riktning. Detektering ska
   ske i **rå kamerabild**, och bara den färdiga spetspunkten warpas.

### Uttagning av pilar
`absdiff` är ett absolutbelopp och kan inte skilja "något dök upp" från "något
försvann". När pilarna dras ur registreras spökkast. Behöver riktad subtraktion
eller ett explicit "tavla rensad"-läge.

### Kalibrering
`computeCalibration` (`boardProjection.ts` + `homography.ts`) är nu en
överbestämd lösare: DLT-startgissning, sedan Levenberg-Marquardt som minimerar
reprojektionsfelet, och den returnerar en residual i px. Den tar N ≥ 4 par.
`App.tsx` använder fortfarande `cv.getPerspectiveTransform` på exakt fyra punkter
för själva warpen — nästa steg är att låta även warpen gå genom `computeCalibration`
med fler, grovt utpekade punkter (kräver riktig tavla för att verifiera).

`HoughCircles`-autodetekteringen antar fortfarande cirkel — den är en ellips så
fort kameran står snett — och **rotationen kan inte bestämmas** av färgmönstret
ensamt (periodiskt: roterar du två sektorer ser tavlan likadan ut).

Planerad lösning: `fitEllipse` på ringens färgmask → polär utveckling (då blir
ringarna horisontella linjer och sektortrådarna vertikala) → `computeCalibration`
med ringpixlarna → **rotationsankare som användaren sätter med ett grovt tryck**
och som sparas i `localStorage`. `syntheticBoard.ts` gör varje steg testbart utan
tavla.

### Sammanslagna pilar
Största konturen tas alltid. Två pilar som sitter ihop ger en spets. Bör jämföra
ny mask mot föregående och isolera det tillkomna området.

## Att göra

1. Spetsdetektering med axelanpassning, utförd i rå kamerabild
2. Tap-to-correct: rätta en feltolkad pil genom att trycka i Vision View
3. Hantera uttagning av pilar
4. Lokal kalibrering: ellips → polär utveckling → `computeCalibration` med
   ringpixlar → sparat rotationsankare i `localStorage`. Solvern (steg 1 klart:
   `homography.ts`) och offline-fixturen (`syntheticBoard.ts`) finns redan.
5. Mät pilens parallax med `syntheticBoard.ts` (pil som 3D-segment mot kameran):
   avgör om en kamera räcker eller om vinkeln måste vara brant uppifrån.
6. Farfar-regelmotor, delad med `kps-dart-scorecard`
7. Service worker för fullt offline-läge (opencv.js är 10 MB och bör precachas)
8. Lokal ML (DeepDarts-liknande keypoint-modell) som ersättning för steg 1 och 4

## Fallgropar

- **OpenCV.js Mat:er städas inte av garbage collectorn.** Varje `new cv.Mat()`,
  `.clone()` och `.roi()` måste `.delete()`:as. Allokera utanför rAF-loopen.
- **Callbacks från React i refs**, inte i effektens dependencies — annars byggs
  detektorn om vid varje kast.
- **Aldrig både hårdvaruzoom och CSS-transform.** Det gav dubbel zoom och en
  felaktig homografi. Nu används bara hårdvaruzoom, och reglaget visas bara om
  kameran stödjer det.
- **Rimlighetskontroller får förkasta, inte "rätta".** En tavla sedd snett ska
  vara osymmetrisk; tvingar man fram symmetri förstörs perspektivet.
