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
