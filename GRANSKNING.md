# Granskning 2026-09-18: kod, UX, metodval

Gjord utan tillgång till tavlan. Allt som gick att verifiera med tester,
kodläsning eller mätning mot de sparade fotona är verifierat; allt annat är
markerat **hypotes** och ligger i `TESTPLAN.md`.

Fyra granskningar ligger bakom: detektorn och kalibreringskedjan (läst rad
för rad), regelmotor + persistens (körd mot scenarioskript), UX (form,
funktion, flöde, användbarhet) och en omvärldsjämförelse mot DeepDarts,
Autodarts, Scolia, DartsMind, Darteer och ett dussin öppna projekt.

---

## Sammanfattning

**Datorseendet är byggt på rätt sätt.** Pipeline, koordinatsystem,
spets-inte-tyngdpunkt, rå-bild-för-spetsen, avstämning mot tom tavla och
event-sourcad rättning ligger alla i linje med vad de bästa
enkamerasystemen gör. Ingen metod behöver bytas ut. Det som återstår är
finjustering (kalibrering på många ringpunkter, låsta kamerainställningar)
och ett antal logikfel i gränslanden mellan modulerna.

**Rättat i den här omgången, verifierat med tester (300 gröna, bygge OK):**

| # | Vad | Var | Allvar |
|---|---|---|---|
| R1 | Drift-uppdateringen skrev över "tom tavla"-referensen medan oavlästa pilar satt i tavlan → falskt turslut 15 s efter kastet | `useDartDetector.ts` | Hög |
| R2 | Farfar: dold pil som hittas efter att turen stängts bokfördes på **nästa** spelare | `match.ts`, `App.tsx` | Hög |
| R3 | Tjock/avvisade pilar spelades upp som om de räknades; tjock sades aldrig i stunden | `App.tsx`, `useMatch.ts` | Hög |
| R4 | "Avsluta tur" efter "bara 2 av 3 avlästa" avslutade **nästa** spelares tur | `App.tsx` | Hög |
| R5 | Tyst återupptagen match (omladdning < 2 min) fick aldrig någon användaraktivering → ljud och tal låsta hela matchen | `App.tsx`, `audioEngine.ts` | Hög |
| R6 | Panelen var tryckbar under uppstartskortet ("Ångra" ändrade sparad match) | `App.tsx` | Medel |
| R7 | "Byt spel" raderade matchen omedelbart, utan väg tillbaka | `App.tsx`, `GameSetup.tsx` | Medel |
| R8 | Dött `E` vid endTurn utan effekt (StrictMode-dubblering, Farfar) fick "Ångra" att göra ingenting första trycket | `match.ts` | Medel |
| R9 | `insertThrow` i full 301/501-tur lämnade ett dött kast som dök upp igen vid nästa rättning | `match.ts` | Medel |
| R10 | Utgångsförslag saknade 171–180 vid rak utgång | `segments.ts` | Låg |
| R11 | Ensam Farfar-spelare som slogs ut utropades till vinnare | `farfar.ts` | Låg |
| R12 | Trasig lagring (okänt `mode`) gav en x01-motor som trodde matchen var vunnen | `match.ts` | Låg |
| R13 | Spelarbytet läser nu upp ställningen ("Anders kastar. 180 kvar." / "Mål 35, 5 pilar."); TTS säger "Röd bull"/"Grön bull"/"Miss" som pilraden; genitivet "Anderss tur" borta | `App.tsx`, `audioEngine.ts` | UX |
| R14 | Detektorstatus på svenska, safe-area under gestfältet, "Starta Spel" → "Spara kalibrering", hjälptext stämmer med knapparna, "Hoppa över" → "Tillbaka till matchen", enhetligt appnamn | diverse | UX |
| R15 | Talkön håller referenser (Chrome skräpsamlar annars köade yttranden), `resume()` före varje `speak` | `audioEngine.ts` | Robusthet |
| R16 | `useMatch` parsade localStorage på varje rendering | `useMatch.ts` | Prestanda |

Ingenting av detta är committat. Kör `git diff` och committa när du läst.

---

## 1. Detektorn (`useDartDetector.ts`)

### Verifierat genom mätning mot fotona

**Triggern är inte flaskhalsen.** Farhågan var att triggern (tröskel 30 i
den warpade bilden, > 500 skilda pixlar) skulle missa en silverpil över
gräddvitt fält som analysen (tröskel 10) ser. Mätt på fixturerna, avkodade
med `System.Drawing` och körda genom samma blur:

| Bild | thr 10 | thr 20 | thr 30 | konturer thr 10 → 30 |
|---|---|---|---|---|
| silverskaft över gräddvitt, inom tavlan | 19 417 px | 7 646 | **6 407** | 1758 → 20 |
| silverskaft över svart, inom tavlan | 21 181 px | 3 628 | **2 697** | 2945 → 34 |

Båda ligger långt över 500. Min kedja reproducerar också fixturens
pipblobb (2019 px, box 108×36 mot fixturens 2068, 108×36), så mätningen är
jämförbar med appens.

### Rättat (R1)

`emptyBaseline` uppdaterades vid drift när `dartsThisCycle === 0`, men det
gäller också när en pil landat och **förkastats** av analysen. Efter analysen
sätts `baseline := gray` (med pilen), scenen ser lugn ut, och 15 s senare
blev tom-tavla-referensen = tavlan med pilen. Nästa tom-tavla-koll gav då
`emptyPx ≈ 0` med `materialSince` satt sedan 15 s ⇒ `CLEARED` ⇒ `finishTurn`
medan spelaren stod kvar och kastade. Det sabotorade exakt det fall
`MATERIAL_HOLD_MS` byggdes för. Nu krävs dessutom `materialSince === 0`.

### Hypoteser att avgöra vid tavlan, i prioritetsordning

**D1. Snabba kast tappar pil 2 (rapid fire).** `registerNewThrow` med
`tooSoon` (< 1 s sedan förra) **absorberar** blobben in i toppreferensen.
Landar pil 2 0,7 s efter pil 1 hinner den bli stabil vid 1,2 s → tooSoon →
absorberad → syns aldrig mer i diffen mot toppen. Avstämningen mot tom tavla
räddar den bara om något NYTT triggar en analys; annars först när pil 3
landar, och då ser avstämningen två oregistrerade blobbar ⇒ "osäker" ⇒
fallback ⇒ bara pil 3 registreras. Förslag: på `tooSoon`, absorbera inte
och uppdatera inte `baseline`, så nästa 500 ms-fönster analyserar om.
Alternativt ta bort tidsspärren helt: platsspärren (30 px) täcker fallet
"samma pil svänger in sig" som tidsspärren infördes för.

**D2. Avstämningens "nytt kast" använder fel blobb för spetsen.** När
avstämningen säger "nytt kast" tas spetsen ur blobben mot den TOMMA tavlan.
Överlappar pil 2 pil 1 i bild är den blobben unionen av båda, och PCA-axeln
är då skräp. Diffen mot toppen (som redan innehåller pil 1) isolerar den nya
pilens silhuett. Förslag: låt avstämningen **avgöra** att det är ett kast,
men ta spetsen ur `findDartTip(rawThresh, top)`, med avstämningens blobb som
fallback.

**D3. Avstämningen kan trängas ut.** `findDartTips(…, wanted = kända + 1)`
bryter efter `wanted` träffar. Passerar en skugga formtesten och är större
än en riktig pil tar den en plats, den riktiga pilen prövas aldrig, och
utfallet blir "känd borta + ny sedd" = falsk uttagning med dold pil.
Förslag: i avstämningsläget, pröva alla kandidater (max 12); hopparningen
kostar inget. Riktningsspärren `materialDelta` fångar en del av detta redan.

**D4. Omstart med pilar i tavlan.** Tar detektorn sin tom-tavla-referens när
pilar redan sitter där (omladdning inom 2 min mitt i en tur, omkalibrering
mitt i match) blir pilarnas hål vid uttagning "nytt material" och avlånga
blobbar ⇒ spökkast för nästa spelare. Förslag: när detektorn startar och
matchen har `currentDarts.length > 0`, säg "Ta ut pilarna innan du
fortsätter" och vänta med referensen tills tavlan varit stilla utan
material. Enklast: kräv `emptyPx`-lugn i 3 s innan `emptyBaseline` fryses.

**D5. Kameran går på helautomatik.** `getUserMedia` begär bara upplösning
och `facingMode`. Autofokus jagar varje gång en pil flyger förbi, och
autoexponering/vitbalans driver när någon går framför lampan; det är det
drift-uppdateringen försöker kompensera. Android Chrome stödjer
`focusMode`, `exposureMode`, `whiteBalanceMode` via `applyConstraints`
(samma kodväg som zoomen). Autodarts kräver fast exponering, och Carson-Tates
projekt låser båda med kommentaren "autofocus will hunt every time a dart
flies past". Förslag: efter "Spara kalibrering", läs `getSettings()` och lås
fokus, exponering och vitbalans på de värden kameran hittat, bakom en
`?autocam`-flagga för att kunna A/B-testa. Hårdvarutest krävs; kan ge
för mörk bild om låset sker i fel ögonblick.

**D6. Tom-tavla-kriteriet är absolut och trångt.** `CLEAR_PX = 400` av
640 000 vid tröskel 30. Ett litet ljusskifte efter turen (spelaren skymmer
ringlampan) håller tavlan "otömd" tills "Avsluta tur" dyker upp efter 35 s.
Förslag: låt avstämningen avgöra också detta: tavlan är tom när diffen mot
`snapshots[0]` inte innehåller någon pilformad blobb och materialet minskat.

**D7. Prestanda.** Varje rAF-bildruta skapar en ny 1080×1920-canvas,
`cv.imread`, warp, två gråskalor och två 5×5-blur. Det går på S25, men
kostar batteri och värme och gör att telefonen kan strypa efter en timme.
Stabiliseringen är tidsbaserad (500 ms), så 15 fps räcker. Förslag: hoppa
över var fjärde… var tredje bildruta, och räkna rågråskalan bara när den
behövs (analys, snapshot, drift). Canvas-per-bildruta var en medveten fix för
en frusen bild och ska behållas.

**D8. Två dubbletter av "utanför tavlan".** `MAX_PLAUSIBLE_RADIUS_MM = 190`
i `evaluateCandidate` och `BOARD_PX * 0.55` (= 187 mm) i reveal-grenen är
samma gräns skriven två gånger. Kosmetiskt.

### Vad som är rätt och inte ska ändras

Spets i råbild, trigger i warpad. Referensbilder via `copyTo`. Avstämning
mot tom tavla som huvudspår med pixelheuristiken som fallback. Fragment-
gruppering gated på ökad avlånghet. Skuggtestet med "vet inte"-utfall.
Callbacks i refs. Absorbering av bara blobbens yta, inte hela bildrutan.
Alla dessa har en mätning bakom sig och kommentaren säger vilken.

---

## 2. Kalibreringen

### Bedömning

Homografi ur 4 punkter + LM-lösare för N punkter + ellipsanpassning på två
ringar + rotation ur röd/grön-fasen är en fullgod klassisk kedja. Två saker
skiljer den från de mest träffsäkra öppna implementationerna (darts_vader
rapporterar 0,58 mm medianresidual på riktig video):

**K1. Den manuella vägen har noll redundans.** Fyra dragna punkter går rakt
in i matrisen. Autovägen löser däremot över 128 ringpunkter (2 ringar × 64)
och reduceras sedan förlustfritt till fyra kardinalpunkter, så AGENT.md:s
punkt 6 ("låt warpen gå genom computeCalibration") är redan uppfylld för
autovägen. Det som saknas är en **"Finjustera"** som tar de fyra manuella
punkterna som startgissning, letar ringkanten radiellt (±15 px längs den
projicerade 170-, 162-, 107- och 99-mm-cirkeln) i den faktiska bilden, och
löser om med LM och robust förlust. Allt utom bildsamplingen finns redan och
är testbart mot `syntheticBoard`. Störst kvarvarande vinst i kalibreringen.

**K2. Residualen visas inte.** `computeCalibration` returnerar `residualPx`
och `maxResidualPx`; fixturen visar 2,6 px rms / 6,9 px max på Kristians
tavla (≈1 mm / 2,8 mm). Visa den efter Auto och Finjustera: "Passning: 1,1 mm
(bra)". Det är också måttet som avslöjar linsdistorsion (K4).

**K3. Kalibreringspunkterna sitter på fältmitt, inte på trådkors.**
DeepDarts, Dart Sense och alla klick-baserade system sätter punkterna där
en sektortråd möter dubbelringens ytterkant (t.ex. 5|20, 13|6, 17|3, 8|11).
Ett trådkors är en visuell punkt; ett fältmitt måste uppskattas. Med
"Rikta in sektorer" är rotationsfelet redan hanterat, så detta är ett
förslag för den manuella vägens precision, inte ett fel. Kräver ändring av
`CANONICAL_CALIBRATION_MM` (±9°) och alla texter.

**K4. Linsdistorsion är inte modellerad.** Vid 2,1× zoom (beskuren huvud-
sensor) är den liten; vid 1× och särskilt ultravidvinkel inte. Mät först via
K2: ett radiellt mönster i ringresidualen > 1 px motiverar en enda k1-term,
annars inte. Bygg inte blint.

**K5. Zoom kan byta lins.** Samsungs logiska kamera kan byta fysisk sensor
vid vissa zoomnivåer. Kalibreringen sparar zoomen (bra); byt aldrig zoom
under match, och kontrollera att `getSettings().zoom` faktiskt blev det
begärda efter återställning.

**K6. Sparad kalibrering är andelar av containern.** Ändras containerhöjden
mellan sparning och återställning (adressfältet in/ut) ändras `object-cover`-
skalan några procent och punkterna landar ~20 videopixlar fel, tyst.
`aspect` sparas "för att kunna varna" men ingen varning finns. Förslag: spara
punkterna i **videopixlar** och räkna om till skärm vid laddning.

---

## 3. Spetsdetekteringen (`dartTip.ts`, `blobGroups.ts`)

PCA-axel + breddtest är exakt vad de klassiska systemen använder, och
spetsen är det enda parallaxfria man kan mäta med en kamera. Två förbättringar
från litteraturen, båda små:

**S1. Riktad stängning längs axeln.** Delaney (Stanford 2015) stänger masken
med ett **linjeelement roterat till PCA-axeln** innan extrempunkten tas. Det
överbryggar just ett 34–45 px glapp mellan pipa och vinge utan att slå ihop
grannar i sidled, och kompletterar `groupFragments`.

**S2. Krökning som andra röst.** Chen m.fl. (2026) tar spetsen som max
|krökning| på konturens bortre del. Ett oberoende test mot breddtestet:
disagrerar de, sänk konfidensen. Billigt eftersom konturpunkterna finns.

**S3. Stabilisera på spetsposition, inte pixelantal.** darts_vader kräver
"samma spets inom k px i 6 av 8 bildrutor". Det ignorerar handrörelse
någon annanstans i bild och avvisar en pil som fortfarande fjädrar. Vårt
500 ms-krav på pixelantal är samma idé på en svagare signal.

**S4. Adaptiv tröskel.** Chen tröskar vid 98:e percentilen av den
normaliserade diffen; Delaney normaliserar mörka och ljusa fält separat.
Båda ersätter den handtrimmade 10:an. Verifierbart offline mot
`silver-shaft-blobs.json` innan det byggs.

---

## 4. Regelmotorn och persistensen (`src/game/`, `useMatch.ts`)

Reglerna i `x01.ts` och `farfar.ts` följer Farfar-specen i alla prövade
fall (mål 15 +5, röd bull, stapling, sista kvar, alla ut samma runda, rundan
spelas klart, tak efter 18, delad vinst). Felen satt i gränssnittet mellan
event-sourcingen och Farfar; R2, R8, R9, R11, R12 ovan är rättade och
testtäckta (11 nya tester).

**Kvar, och det största ohanterade: Farfar saknar turgränser i kastlistan.**
Farfar-turens längd beror på pilarnas VÄRDEN (målet nås ⇒ stängd), så
listan är inte självbeskrivande. Rättar man en pil i en **tidigare** tur
(A:s första miss var en 20:a) flyttas alla senare pilar mellan spelare:
uppmätt `A:20 B:Miss B:Miss B:20` där sanningen var `A:20 A:Miss A:Miss
B:20`, och matchen är inte längre avgjord. I x01 skyddar `E`-markörerna.
CLAUDE.md lovar "allt går att rätta i efterhand"; för Farfar gäller det i
praktiken bara pågående tur.

Förslag (kräver beslut, det avviker från scorecard-modellen): skriv `E`
även i Farfar, av `match.throwDart` när motorn just stängt turen, och låt
`farfarEngine.endTurn` tvinga stängning vid replay om turen är öppen när
`E` kommer. Då stannar rättningar inom sin tur som i x01. Tills dess: varna
i `TurnHistory` för Farfar att en rättning i tidigare tur påverkar
efterföljande.

Övrigt kvar: `TurnHistory` grupperar ur `log`, så en tur med **noll**
avlästa pilar finns inte där; "Lägg till" för just det fall varningen är
till för leder till en återvändsgränd. Kräver att `TurnHistory` får
`actions` och renderar tomma turer ur `E`. Och `undo` över en turgräns låser
prompten på "Dra ut pilarna" i 35 s (tavlan är redan tom, inget nytt
tömnings-event kommer).

---

## 5. UX: form, funktion, flöde, användbarhet

Utgångspunkt: spelaren står 2,4 m bort och får inte röra telefonen. Allt
som kräver blick på skärmen eller ett tryck under spel är en kostnad.

### Rättat

R3 (tjock och avvisade pilar), R4 ("Avsluta tur" på fel spelare), R5 (tyst
match), R6 (panelen under kortet), R7 ("Byt spel" utan retur), R13
(uppläsning med ställning, målet och pilar), R14 (svenska tillstånd,
safe-area, knappnamn som stämmer med hjälpen).

### Kvar, rankat efter hur ofta det slår till en vanlig kväll

**U1. Skärmen är byggd för handen, inte för 2,4 m.** Kameran fyller hela
ytan och allt spelrelaterat trängs i en remsa längst ner: statusraden 16–18
px, aktivt namn 10 px, Farfar-målet 14 px, pil-toasten 24 px i 2,5 s. Från
kastlinjen är bara 301/501-resten läsbar. Kamerabilden har inget värde för
spelaren under spel. Förslag: ett **spelläge** när detektorn går: panelen tar
hela ytan, kameran blir miniatyr (finns redan som 32 px-canvas), prompt
≥ 40 px, egen ställning ≥ 96 px, alla spelares ställning i en lista.

**U2. Farfar saknar det Farfar handlar om.** Sparade pilar syns bara som
antal rutor (kapade vid 8), utslagna syns ingenstans under spel, målet är
14 px. Uppläsningen är rättad (R13); skärmen är kvar. Hör ihop med U1.

**U3. Återvändsgränd vid noll avlästa pilar.** Se avsnitt 4.

**U4. Kalibreringsknapparna är omärkta ikoner på telefon.** Under 640 px
döljs etiketterna på "Peka ut 20:an", "Rikta in sektorer", "Återställ",
"Sikte", och `title` visas aldrig på touch. För en icke-teknisk kompis:
obegripligt. Förslag: alltid text, i två rader eller bakom en "Mer"-meny.
Överväg att köra "Rikta in sektorer" automatiskt vid "Spara kalibrering"
när konfidensen är över 0,6.

**U5. "Ångra" efter turslut.** Låser prompten i 35 s (avsnitt 4). Ingen
rättning läses upp: man rättar på skärmen, går tillbaka till linjen och vet
inte vad ställningen blev. Förslag: `speak(nyStällning, {cancel: true})`
efter varje rättning; visa "Avsluta tur" direkt när sista ångrade handlingen
var ett `E`.

**U6. GameSetup minns inte spelarna.** Bara "Spela igen" gör det. Spara
senaste spelarlistan. Standardläge är 501 trots att Farfar är målet.

**U7. Kalibrering i andelar av containern.** Se K6.

**U8. Kamera nekad / OpenCV-fel** har ingen "Försök igen"; `useOpenCV`
cachar avslaget för alltid.

**U9. Skak-tol-reglaget är `hidden sm:flex`** och finns därmed aldrig på en
telefon, trots att CLAUDE.md kallar det reglerbart. Antingen visa det bakom
`?debug` eller stryk påståendet.

### Bra, ändra inte

Statusraden först och principen "inget tryck under spel". "Avsluta tur"
gömd tills något hängt sig. Event-sourcad rättning hela vägen ut i UI:t med
Röd/Grön separat. Talkön som inte klipper. ResumeCard med ålder. Loupen och
32 px-träffytan vid kalibrering. Detektorn av under överlägg. Wake lock och
återupptagen video. `h-[100dvh]`, `lang="sv"`, try/catch runt localStorage.
Kommentarer som förklarar varför.

---

## 6. Metodjämförelse mot fältet

Källor och siffror i korthet (fullständig research finns i sessionen;
länkar nedan).

| System | Kameror | Publicerad träffsäkerhet |
|---|---|---|
| DeepDarts D1 (rakt framifrån, egen kamera) | 1 | 94,7 % rätt turpoäng |
| DeepDarts D2 (varierande vinkel) | 1 | 84,0 % |
| Dart Sense (YOLOv8n, 24k bilder) | 1 | 88,4 %, 4 % missade pilar |
| darts_vader TipNet, ny kameraposition | 1 | 73–79 % |
| Carson-Tate (klassisk, egen tavla) | 1 | "85–92 %" |
| DartsMind (användaromdöme) | 1 telefon | ~1 rättning per 30–40 pilar |
| PEELA | 2 fisheye | precision 0,98 / recall 0,92 |
| Autodarts DIY | 3 + ringljus | "upp till 99 %" |
| Scolia Home / Pro | 3 + ljus | 99,5 / 99,8 % |
| Target Omni | 4 + ljus | 99,7 % |

Ärlig läsning: en välbyggd enkameralösning landar på **85–95 % rätt per
pil**, med resten nästan helt skymning (olösbart med en kamera) och
gränsfall/parallax (delvis lösbart). 99 % kräver en andra vinkel. Ingen
enkameraprodukt publicerar en siffra.

### Var vi står mot det

| Område | Fältet | Vi | Bedömning |
|---|---|---|---|
| Spets vs tyngdpunkt | Alla seriösa: spets | Spets, PCA + breddtest | I linje |
| Var spetsen mäts | I råbild, sedan homografi | Råbild | I linje |
| Bakgrundsmodell | absdiff mot referens som nollställs per pil | Samma | I linje; MOG2/KNN används av ingen |
| Add/remove/hand | Pixeltrösklar, "stor förändring sedan lugn" | Positionsbaserad avstämning + materialriktning | **Bättre än de flesta öppna** |
| Fragmenterad pil | Riktad stängning (Delaney) | groupFragments | Likvärdigt; S1 är komplement |
| Kalibrering | Många ringpunkter + LM, 0,58 mm (darts_vader) | Auto: 128 punkter + LM. Manuell: 4 punkter | K1 stänger gapet |
| Rotation | Färgparitet + trådar/numrering | Färgfas ±18° + "20 upp" | I linje |
| Ljus | Ringljus krävs eller starkt rekommenderas överallt | Ringljus (mätt: 491 → 11 konturer) | I linje |
| Kamerainställningar | Fast fokus/exponering | Helautomatik | **Gap** (D5) |
| Stabilitet | Spetsposition i 6/8 bildrutor | Pixelantal i 500 ms | Gap (S3) |
| Rättning | Tap-to-correct, korrigeringslogg | TurnHistory, ingen logg | Logg saknas |
| Occlusion | Andra kamera, eller upptäck vid uttag | Avslöjande vid uttag | I linje för en kamera |

Att anta, i ordning efter vinst per insats: D5 (lås kameran), K1
(finjustera på ringkanter) + K2 (visa residual), D1–D3 (detektorlogik), S1
+ S3, S4, korrigeringslogg med mm-avläsningar (enda vägen till egna
siffror), U1/U2 (spelläge). Inte värt: MOG2/KNN, hudfärgsdetektering,
skuggan som ledtråd, stålspetsens färg (blank, opålitlig).

Långsiktigt och bara med ditt godkännande: en liten lokal keypoint-modell
(ONNX Runtime Web, tränad på DeepDarts + egna rättningar) och en andra
telefon över WebRTC på lokalt nät. Båda ryms inom "ingen backend".

Källor: arXiv 2105.09880 (DeepDarts), github.com/bnww/dart-sense,
github.com/cruleon/darts_vader, github.com/hanneshoettinger/opencv-steel-darts,
web.stanford.edu/class/ee368/Project_Autumn_1516/Reports/Delaney.pdf,
autodarts.diy, docs.autodarts.com/getting-started/detection/lens/,
scoliadarts.com/faq, stlabs.is/project3, patent US10962336B2, arXiv 2604.01130.

---

## 7. Ordning framåt

1. **Testsessionen** enligt `TESTPLAN.md`. Den verifierar R1–R5 och avgör
   D1–D6.
2. Direkt efter, med felen färska: **korrigeringslogg** (kastindex →
   area, bbox, elongation, konfidens, avstämningsutfall, spets i mm).
3. **Farfar-turgränser** (`E` i Farfar) om du godkänner avsteget från
   scorecard-modellen.
4. **Kameralås** (D5) bakom flagga, sedan default om det håller.
5. **Finjustera kalibrering** på ringkanter + residual i UI (K1, K2).
6. **Spelläge** för 2,4 m (U1, U2).
7. Detektorns D1–D3 och S1/S3, var för sig, med mätning före och efter.

---

## 8. Mätt vid tavlan 2026-10-04

Ny uppställning: Winmau Blade X med surround inomhus, kamera nästan rakt
framifrån, zoom 2,15×, tavlan 781–812 px bred (2,3–2,4 px/mm). Allt styrt
från datorn över adb/CDP; ingen rörde telefonen under spel. Sladden var
odatacertifierad: adb tappade kontakten två gånger och telefonen laddade ur.

**Godkänt**

| Test | Resultat |
|---|---|
| Autokalibrering (ellips + sektorfas) | Satt på första klicket, sektorlinjer på trådarna, två gånger |
| Kastade pilar, yttre fält | 12 av 12 rätt: S10, S7, 25, S17, S7, S5 (nära 20/5-tråden), S8@29 mm, S13, S7@28 mm, 16, 25, 5 |
| Axelkonfidens på riktiga kast | 0,62–0,76 (gränsen 0,33) |
| Handplacerad röd bull, ~1 mm vänster-nedåt | **DB@1mm/197°** |
| Handplacerad grön 25 vid 19/3-tråden (tråd 189°) | **25@14mm/187°** |
| Snabba kast, 3 på 2,3 s (1,3 och 1,0 s mellanrum) | Alla tre rätt, i ordning |
| Skuggtest | Förkastade riktiga skuggor 6 gånger (r 0,80–0,98), aldrig en pil |
| Uttagning en-i-taget med paus | Rena avstämningar varje gång, tömd → spelarbyte, rätt uppläsning |
| R1 (drift-uppdateringen) | Betedde sig rätt med pil i tavlan |
| R9 (insättning utan effekt rullas tillbaka) | Räddade matchen från två spökkast |
| Reservvägen för oläst dold pil | "Bara 1 av 3 pilar avlästa" med banner, som avsett |

**Fel som hittades och rättades under kvällen**

1. **Sammansmälta blobbar mot tom tavla** (D2, bekräftad): två pilar som nuddar
   varandra blir en blobb på 13 700 px (en pil: 7 500). Som nytt kast blev
   spetsen rätt av tur; vid uttagning parades blobben med en pil och den andra
   bokfördes som uttagen, varpå den "hittades" igen som dold pil. Rättat i
   `f61d660`: spets ur diffen mot förra bilden, storleksspärr 1,5× i
   avstämningen, nyss glömda pilar får inte bli dolda.
2. **Analys medan en arm står stilla i bild** - roten till alla spökkast. En
   pil ger 7 000–14 000 skilda pixlar, armen 47 000–137 000. Avstämningen
   såg den skymda pilen som uttagen och en del av armen som dold pil; ett
   spökkast på 6 bokfördes. Rättat i `cbcf5a4` med bildnivåspärren
   `HAND_PX`; verifierad direkt efteråt (fem väntande analyser, sedan en ren
   registrering).

**Kvar**

- Dold pil med spetsar > 3 cm isär (försöket hade 10 mm; under
  `MIN_DART_SPACING_PX` är det per definition samma pil).
- Tömd-signalen uteblev en gång i tur 1 (tavlan var tom i 2 minuter). Orsaken
  är inte fastställd; `emptyPx` loggas nu i heartbeaten.
- D1 (snabba kast) står kvar som risk: marginalen till 1-sekundsspärren var
  0,0–0,3 s.
- Bildtakten var 10–13 fps med `?mask`, mot 60 i september. Mät utan mask.
- En halvt skymd pil vid trippeltråden lästes 4 mm fel (111 mm mot T13:s
  99–107). Partiella silhuetter ska inte avgöra en ring.

---

## 9. Byggt efter sessionen 2026-10-04 (kvällen), otestat på hårdvara

Kristians tre invändningar efter kastningen, och vad som gjordes:

**"15 mm mellan spetsarna kommer inte att fungera, man sätter ofta tätt."**
Rätt. Spärren fanns för att hålet efter en uttagen pil ser ut som pilen i
diffen mot förra bilden. Nu avgörs hål/pil på innehållet i stället:
`materialFraction` mäter hur stor del av blobbens egna pixlar som skiljer sig
från den TOMMA tavlan (en pil täcker tavlan, ett hål visar den igen).
Positionsspärren för nya kast sänkt till 12 px (~5 mm), avstämningens
hopparning till 25 px (~10 mm). Samma test skyddar dold-pil-grenarna.

**"Kan den rätta sig själv när pilarna dras ut?"** Ja, i det fall som går
att göra säkert: när EN pil står ensam kvar syns hela silhuetten för första
gången. Läses den då i ett annat fält än det registrerade (area normal,
axelkonfidens ≥ 0,6, flytt ≥ 8 px) rättas kastet via nya `onDartCorrected`
och sägs högt: "Rättar: 6 blir 10". Detektorn ger varje pil ett löpnummer
så App hittar rätt kast i kastlistan även efter insättningar. Kravet för att
det ska hända är att pilarna dras ut **en i taget med armen ur bild** så
att en analys hinner köras mellan uttagen; rycker man alla tre töms tavlan
bara (vilket också är rätt). Två sekunder räcker; det är stillhetskravet på
500 ms plus att armen ska vara borta.

**"Den blå ringen går lite för långt ner."** Mätt mot kvällens sista
bildruta med `scripts/measure-rings.ts`: dubbelringens färgkant låg på
170,0 mm uppe, till höger och till vänster, **167,0 nertill**. Ny
`ringRefine.ts` letar färgkanten längs 360 strålar för dubbel- och
trippelringen och löser homografin överbestämt (LM). På samma bild efter:
alla fyra kvadranter inom ±0,3 mm av färgkanten. Körs sist i Auto och via
knappen "Finjustera", som säger hur fel det låg. Syntetiskt test i
`ringRefine.test.ts`. Lärdom från det: färgen slutar ~0,6 mm innanför den
nominella radien eftersom tråden täcker gränsen; siktar man på 170 och 107
rakt av får ringarna olika relativa fel och passningen kompromissar.

Allt detta är verifierat med tester och mot den verkliga bildrutan, men
inte med en enda pil i tavlan. Testordningen står i `TESTPLAN.md`:s banner.

### Två fel till, hittade i den riktiga matchen senare samma kväll

Kristian och vännerna spelade vidare på det nya bygget med loggen igång.
Båda felen hittades, mättes mot sparade bildrutor och rättades samma kväll.

**"D3 blev 18."** Vision-vyn visade P3 på D3, alltså var spetsen rätt;
18:an kom från en separat registrering som sedan glömdes. När pil 3 slog i
vibrerade tavlan, pilen i 1:an flyttade sig någon pixel, och diffen mot förra
bilden visade en smal remsa längs dess kropp med "spetsen" vid vingen i
sektor 18. Remsan registrerades, den riktiga D3 kom in i en full tur och
räknades inte, och avstämningen tog bort remsan som "uttagen". Rättat med
`priorMaterialFraction`: en blobb som till > 50 % ligger där det REDAN fanns
material är en pil som rört sig, inte ett nytt kast. Loggen visar numera
"fanns före N %" för varje registrering (0–2 % för riktiga kast efteråt).
Samma vibration sågs direkt igen: hela S15-pilen dök upp som "ny" skillnad
1 px från sin registrering och stoppades av 12 px-spärren.

**"T15 blev S15 på 98,5 mm."** Sektorn var rätt, radien 1–6 mm för kort.
Fotoparet (tom tavla + pil, `scripts/tip-profile.ts`) visar varför:
pilkroppen är 100–140 gråvärden ljusare än tavlan, stålspetsen nästan
neutral, och sedan följer 12 px som är 13–34 gråvärden **mörkare än den tomma
tavlan men med tavlans mönster**: pilens skugga, som med ringlampan faller
inåt mot bullen. Den tas med i masken (tröskel 10), binds ihop med pilen av
morfologin, och axelmetodens extrempunkt hamnar i skuggans ände, 6 mm för
långt in. `trimShadowAtTip` går bakåt längs axeln förbi allt som inte är
pilmaterial; samma bildpar ger då 105,9 mm, i trippeln. Kvar är ~1 mm i
sidled: PCA-axeln går genom blobbens tyngdpunkt, och skuggremsan längs ena
sidan drar den åt skuggsidan. Det är nästa förbättring (S1 i avsnitt 3:
axel ur pilkroppen, inte hela blobben).

**"S18 blev S4."** Spetsen lästes 46° på 27 mm radie; tråden ligger på 45°.
Så nära bullen är 1° en halv millimeter, och precisionen är omkring en
millimeter. Inget fel att rätta i detektorn; det är fallet för
osäkerhetsflaggan ("18 eller 4?") på avstånd till närmaste tråd.

### Sista varvet (23:00), ur loggen från snabbt riktigt spel

Fyra småsaker till, alla rättade i `c200e21` och commiten efter:

- **Armspärrens tålamod (8 s) gick ut** när en spelare stod vid tavlan
  längre än så, och en bild med armen i analyserades (70 000 px, skräpblobb
  registrerad). Rörelse nollställer nu timern: ett ljusskifte rör sig inte,
  en människa gör det.
- **Skuggtrimningen nådde taket 20 px** i tre av fem registreringar:
  stålspetsen över gräddvitt ser ut som skugga. Taket 16 px begränsar
  övertrimningen till ~1 mm.
- **En kompakt blobb** (vinge på en pil som rört sig, 47 % gammalt material)
  registrerades via tyngdpunkten som MISS på 175 mm. Tyngdpunktsgrenen kräver
  nu < 25 % gammalt material.
- **En person framför tavlan i 11–25 s räknades som "en tur har spelats"** och
  nästa spelares tur avslutades med noll pilar när personen gick (två gånger).
  Material över 45 000 warpade pixlar är inte pilar och nollställer timern.

Positivt ur samma logg: hålet efter en uttagen pil avfärdades korrekt flera
gånger, en skymd tredje pil hittades som dold vid uttagningen och sattes in,
spärren "nyss glömd pil" stoppade en felaktig dold pil, och den nya
"fanns före"-mätningen låg på 0–9 % för riktiga kast.

**Lärdom för nästa session:** riktigt, snabbt spel med flera personer vid
tavlan är en helt annan miljö än ensamkastning med paus. Allt som bygger på
"stilla bild" måste tåla att någon står i bild i halvminuter.

---

## 10. Testpass 2026-10-05 (Opus 5.5)

Samma uppställning, ny modell i Claude Code. Allt styrt från datorn; Kristian
fjärrstyr telefonen via Samsung Flow från en surfplatta.

| Test | Resultat |
|---|---|
| Rigg, rätt bygge, en flik | OK |
| Knapparna i kalibreringsvyn | OK, layouträttningen från 10-04 håller |
| Auto + Finjustera | Rotation 0,25° fel (konfidens 0,95), sektorgränserna på rätt grad längs trippeln |
| Två handplacerade pilar 14 mm isär | Två kast, avståndet rätt på 0,5 mm |
| Två pilar 7–10 mm isär med piporna mot varandra | Pil två missad: pil ett knuffades och de blev en form. Fysisk gräns |
| Uttag av den missade | Hålet avfärdat korrekt |
| T15 och T6 handplacerade mitt i | 1–3 mm från mitten; skuggtrimningen flyttade T6 från 100 till 104 mm |
| Person framför tavlan efter turslut | Nästa spelares tur orörd |
| Tre snabba kast nära varandra | Inga extra pilar; två riktiga missar över pil ett:s vinge togs först för vibration (rättat) |
| Dold pil vid uttag | En oregistrerad miss avslöjades och sattes in rätt |
| Varning "bara N av 3 avlästa" | Fungerar, med Lägg till |
| Tre pilar i en tät klunga utanför D20 | 1 av 3 läst, ingen gissad poäng. Fysisk gräns |
| Appbyte via Samsung Flow | Zoomen återställs av sig själv efter rättningen |

**Rättat under passet** (`dec9f38`, `541a78a`):

- **Appbyte tappade hårdvaruzoomen** medan `getSettings().zoom` fortfarande
  sa 2,04. Hela bilden ändrades, kalibreringen blev fel utan att något sa
  till, och en hel tur lästes i 1× med fel kalibrering. Nu läggs zoomen på
  igen efter appbyte (1,5 → 2,1 med 0,8 s paus; 0,1-steg utan paus gjorde
  ingenting), och automatiskt så fort detektorn ser en helbildsändring.
- **Helbildsändring tolkades som ljusskifte** efter 8 s och bokförde en pil
  som uttagen. Över 40 % ändrad bild rör nu aldrig pilarna; efter 8 s röd
  ruta + uppläsning, och den släpper när bilden är tillbaka.
- **"Pil som rört sig" tog två riktiga missar** vars vingar låg över en
  registrerad pils vinge (51–52 % "fanns före"). Spärren kräver nu också att
  minst 10 % av blobben lämnats tom (`vacatedFraction`): en pil som rör sig
  lämnar yta efter sig, en ny pil ovanpå en gammal gör det inte. Riktiga kast
  efteråt loggade "lämnat 0 %".
- **Finjustera-meddelandet** räknade trådens 0,6 mm som fel.
- **Väntetimern för främmande föremål** låg kvar efter ett appbyte som rättat
  sig självt, så tålamodet var slut nästa gång en arm kom in.

**Fysiska gränser, inte buggar:** pilar vars pipor ligger mot varandra
(< ~10 mm och vidrörande), och klungor där vingarna överlappar helt. Appen
avstår i båda fallen i stället för att gissa, varnar vid turslut, och
dold-pil-funktionen plockar upp en del vid uttagningen. Värt att veta: i
klungan läste den avslöjade pilen D20 på 168 mm där sanningen var en miss
strax utanför - en delvis skymd pil är inte pålitlig ens när den syns, och
spärren som stoppade insättningen gjorde rätt av fel skäl. Rör den inte
utan att först göra den avslöjade pilens avläsning säkrare.

**Fel som jag själv gjorde under passet:** räknade två gånger med att
sektor 15 ligger på 126–144° (den ligger på 117–135°) och påstod ett
kalibreringsfel som inte fanns. `scripts/check-cal.ts` visade det på
några sekunder; använd den innan ett kalibreringsfel påstås.

**Kvar till nästa pass:** självrättningen av en ensam kvarvarande pil har
fortfarande inte setts (gick inte att framkalla); osäkerhetsflagga för pilar
under en millimeter från en tråd; och att avslöjade pilar ur en klunga ska
kräva samma säkerhet som ett vanligt kast.

**Byggt efter passet samma kväll** (`3d500aa`): rättningsloggen. Varje kast
från detektorn bär med sig vad den såg (`MatchAction.d`), och varje
rättning, borttagning eller inlagd missad pil skrivs till localStorage med
både det avlästa och det rättade värdet. `node tools/corrections.mjs`
hämtar loggen över USB. Pixelmåtten för ny pil / hål / skakad pil är
utbrutna till `utils/blobPixels.ts` med tester. Inget av detta ändrar
avläsningen.

## 11. Testpass 2026-10-06: en hel 501-match

Kristian kastade för två spelare, ensam, en hel 501-match (tur 12 nåddes)
och sa facit när appen läste fel. Rättningar byggdes mellan turerna.
Kalibreringen gjordes bara med Auto, i den förenklade vyn (`e98bd91`), och
satt på första försöket: rotationen mättes efteråt till -0,25° med
konfidens 0,99.

**Siffrorna ur telefonen** (`capture/2026-10-06/`, gitignorerad): 64
avläsningar från detektorn, varav 5 rättade för hand. Dessutom några pilar
som inte lästes alls vid kastet; flera av dem hittades när den
framförvarande drogs ut. De fem rättningarna:

| Avläst | Sanning | Orsak |
|---|---|---|
| T6 på 103 mm | S15 nära bullen | Tyngdpunkt på en lång, bred blobb (219×108 px) |
| S16 vid 225,8° | S7 | 0,85 mm från tråden |
| MISS på 179 mm | S20 | Bara vingen syntes, pilen skymd |
| S15 vid 117,3° | S10 | 0,45 mm från tråden |
| S14 på 98,7 mm / 296,7° | T9 | Hörnet: 0,35 mm från både trippelringen och tråden |

Tre av fem är alltså gränsfall under en millimeter, med en kalibrering som
samtidigt var rätt på en kvarts grad. Det är precisionsgränsen för en
kamera, inte något att kalibrera bort.

**Rättat under passet:**

- **Skuggtrimningen flyttade pilar över gränser** (`cea2325`, `e3b4e1b`):
  10 px trimning gjorde S15 nära bullen till S10 och T18 till 107 mm, och en
  pil som pekade UTÅT trimmades från T11 till S11. Taket är nu 6 px, och
  trimningen körs bara när pilen pekar inåt (inom 30°), där skuggan faller
  vid spetsen.
- **Tyngdpunkten på en lång blobb** gav T6 för S15. Nekas nu över 150 px.
- **Dubbelt turavslut:** "Avsluta tur" plus tom tavla tog nästa spelares
  tur med noll pilar. En manuellt avslutad tur avslutas inte igen.
- **Reservregeln "uttag med rest" läste nya pilar som uttag**, tre gånger.
  Den gamla pilen glömdes och registrerades sedan som ett nytt kast (19, 13,
  19 där sanningen var 19, 3, 13). Grenen är avstängd (`ffa36e1`), och
  avstämningen säger först till om formen troligen är två pilar ihop
  (`ca7631c`).
- **Tom-tavla-referensen skrevs över** med två oregistrerade pilar när en
  avvisad blobb absorberades. Nivå 0 rörs inte längre medan något sitter i
  tavlan.
- **Spärren mot nyss glömda pilar** (60 px) blockerade riktiga dolda pilar
  32–36 px bort. Nu 20 px.
- **Bara vingen synlig** lästes MISS på 179 mm. En kompakt klump utanför
  tavlan förkastas nu.
- **En pil som föll ur** (S7, efter 1,0 s) tömde tavlan och bytte spelare
  med poängen kvar. Försvinner en pil inom 2,5 s blir kastet 0 och turen
  fortsätter. **Otestad:** ingen pil föll ur efter rättningen.

**Byggt efter passet samma kväll:**

- **Osäkerhetsflagga** (`cb19af9`). Ligger spetsen ≤ 1,0 mm från en tråd
  eller ringkant läses grannfältet upp ("15 – eller 10", vid hörn "nära
  gränsen"), pilen visas gul med ? och rättningsvyn har grannfälten som
  snabbval. Mätt på kvällens data flaggas 10 av 64, och alla tre gränsfel
  finns bland dem. Flaggan ändrar inte vilken poäng som räknas.
- **Återställd kalibrering kontrolleras nu faktiskt** (`610b030`). Kontrollen
  mot tavlan (sektorer och ringkanter) väntade på att videon skulle få
  storlek, men effekten kördes aldrig igen. Meddelandet låg kvar på
  telefonen i kväll utan att något hände.
- **grab.mjs sparar detektorns indata** (`a67d90c`) för de tre senaste
  analyserna: rå gråskala, toppen av stacken och tom tavla. Kollisionsfallen
  i kväll gick inte att köra om, eftersom bara bildrutan efteråt fanns.

**Kvar, i den ordningen:**

1. Kollisionsfallet: en knuffad gammal pil och en ny pil blir en form, och
   spetsen hamnar på den gamlas spets. Kör `node tools/grab.mjs` direkt
   nästa gång det händer.
2. Utfallet "pil föll ur" i spel.
3. Om flaggan pratar för mycket. 1 av 6 kast är mycket om de flesta ändå
   blir rätt.

## 12. Testpass 2026-10-08: Farfar

Två hela Farfar-matcher och en påbörjad. Kristian kastade för två spelare
och sa facit. Kalibrering med Auto, som satt på första försöket. USB-sladden
glappade en gång (CDP-anropen tog ~20 s styck tills den sattes om).

**Verifierat i spel:**

- **Osäkerhetsflaggan.** Fångade tre riktiga gränsfel: 7→19 på 0,05 mm,
  13→4 och 2→15 på 0,05 mm. Ingen pil på en tråd lästes fel utan "eller".
  Flera flaggade pilar var rätt; de loggas inte (en bekräftelse med samma
  värde räknas inte som rättning), så träffsäkerheten går inte att räkna.
- **"Kasta vidare, N pilar kvar"** (`d95304d`, byggt under passet). Med
  sparade pilar hämtar man sina tre mitt i turen; förut kom "bara 3 av 6
  pilar avlästa" varje gång. Fungerade utmärkt.
- **Pil som föll ur innan analysen** registrerades inte alls - rätt.
- **grab.mjs med detektorns indata.** Sju felfall sparade med referensbilder
  (`capture/2026-10-08/`). Hämtningen fick göras om i bitar om 512 kB.

**Fel, med bildpar:**

| Fall | Vad som hände |
|---|---|
| Ny pil ~10 mm från en gammal | En form, 1,27× en pils yta (spärren för "två pilar ihop" kräver 1,5×). Kopplades ihop med den gamla spetsen, den nya missades |
| Ny pil över en gammal vinge | Rund klump (233×159 px), ingen axel - avstod |
| Ny pil som knuffade den gamla | 82 % "fanns före", 14 % "lämnat tomt" → avvisad som "pil som rört sig". Referensen fick sedan med den, och omkastet gav ingen analys |
| Uttag av den lästa pilen ur en sammansmält form | Självrättningen tog den kvarvarande pilen för samma pil omläst: "Rättar 1 blir 20" i stället för att lägga till 20 |
| Byte av spelare mitt i en Farfar-tur | Spelare 1 hade 8 pilar och 25 av 30 efter tre kast; Spelare 2 kastade, och hans 15 hittades vid uttaget som "dold pil" i Spelare 1:s tur. Inget detektorfel - jag tolkade det först som en fallande pil som registrerats tre gånger, men Miss/20/5 var Spelare 1:s riktiga kast |
| Omläsning av samma pil 27 px bort | Avstämningen (25 px) tappade den och la in den igen som "dold pil" |
| T1 läst som S1 | Spetsen 97 mm, trippeln börjar 99 - 2 mm för långt in, "delar=2" (stålspetsen saknades troligen i masken) |
| S7 på 26 mm, sanningen 16 | Konfidens 0,41, 377 konturer - brokig mask, 1,4 mm från tråden |

**Huvudsaken:** fem av felen är samma sak - två pilar som i bild blir en
form. Signalen som saknas är formens yta över tid: drar man ut en pil ur en
sammansmält form krymper den med en pils yta men försvinner inte. Då är
den kvarvarande en ANNAN pil (ny pil, inte omläsning). Det löser både de
missade tätt sittande pilarna och den felaktiga självrättningen.

**Inte löst:** kontrollen av sparad kalibrering vid start visar ingenting
alls på telefonen, inte ens "kontrollerar..." (spårat inifrån sidan med
100 ms upplösning). Misstanke: spärren "användaren har ändrat punkterna"
slår till direkt och tömmer statusraden.

**Att göra, i ordning:** (1) sammansmälta pilar via ytan över tid, (2) tom
ruta i pilraden ska gå att trycka på för att lägga till en pil, (3) logga
bekräftelser, (4) kalibreringskontrollen vid start, (5) en ny pil som
knuffar en gammal ska inte avvisas som "pil som rört sig".

**Byggt efter passet samma kväll** (`a972dd0`, `9df702f`, `bc8d120`), alla
mot kvällens bildpar:

- **Rå-trigger.** D20-pilen som "missades" gav aldrig någon analys: den låg
  nästan helt utanför den warpade kvadraten (warpad skillnad 207 px mot
  gränsen 500, rå 9 866 px). Var tredje lugn bildruta jämförs nu även
  råbilden.
- **Andra försök utan gammalt material.** Klumpen där ny vinge låg över
  gammal vinge blir en pilform när det gamla materialet tas bort, och
  spetsen hamnar i S20 - rätt.
- **Uttag ur sammansmält form.** Minskar materialet med en pil samtidigt som
  spetsen flyttar sig, är den kvarvarande en annan pil: den läggs till i
  stället för att den lästa skrivs om ("1 blir 20").
- **Tom ruta i pilraden** går att trycka på för att lägga till en missad
  pil; en handinlagd pil räknas så att den inte avslöjas igen vid uttaget.
- **Bekräftelser** loggas (`confirm`).
- **Kalibreringskontrollen** loggar varje steg med `[kal]` under `?debug`.

**Tolkat fel först, rättat efter bildparen:** "pil som rört sig" (D20-fallet)
var rätt - pil 3 studsade och knuffade den nedre pilen, bilden visar bara
två pilar. T1 läst som S1 var skymning: den nya spetsen satt bakom den gamla
pilens skaft sett från kameran. Ingen åtgärd.

**Inte gjort:** dubbletten där samma pil mättes om 27 px bort och lades in
som "dold". Materialminskningen kan inte skilja den från en helt dold pil
som blottas när den framför dras ut, och bildparet är för rörigt för att
avgöra vad som hände.
