# Testplan vid tavlan

Skriven 2026-09-18 efter granskningen (`GRANSKNING.md`), som ersättning för
planen från 2026-09-12. Sedan senaste hårdvarusessionen (2026-09-12) har
**allt nedan byggts utan att ett enda kast setts**. Planen är ordnad så att
det som allt annat vilar på testas först, och så att ett fel går att
lokalisera i stället för att bara konstateras.

Räkna med **90–120 minuter** för hela planen. Del A–D är obligatoriska
grindar; del E–G går att ta en annan kväll.

---

## Vad som är otestat på hårdvara

| Vad | Var | Byggt |
|---|---|---|
| Fragmentgruppering (silverskaftet) | `blobGroups.ts` | 09-12 |
| Automatisk sektorrotation + "Rikta in sektorer" | `sectorPhase.ts` | 09-12 |
| Positionsbaserad avstämning (kast / uttag / dold pil) | `dartCensus.ts` | 09-12 |
| Uttagningsordning fri, dold pil sätts in sist i turen | `App`, `match.ts` | 09-13 |
| Tur utan avläst pil avslutas efter 3 s material | `useDartDetector` | 09-12 |
| Statusrad, "Avsluta tur" gömd, uppstartskort | `Scoreboard`, `ResumeCard` | 09-12 |
| **R1** Tom-tavla-referensen fryses medan pilar sitter kvar | `useDartDetector` | 09-18 |
| **R2** Dold pil i Farfar hamnar hos rätt spelare | `match.ts` | 09-18 |
| **R3** Tjock sägs direkt; avvisade pilar säger "Räknas inte" | `App` | 09-18 |
| **R5** Ljud/tal låses upp vid första pekning även efter tyst återupptagning | `App`, `audioEngine` | 09-18 |
| **R13** Spelarbytet läser upp ställning / mål och pilar | `App` | 09-18 |

---

## Riggen: så här kör vi utan att röra telefonen

Telefonen ansluts över USB (utvecklarläge + USB-felsökning). Allt läses från
datorn. Vill du slippa kabeln: `adb tcpip 5555` och `adb connect <ip>:5555`.

| Kommando | Vad |
|---|---|
| `npm run phone:check` | Telefon, bygge, `?debug`, att videon rullar, tavlans storlek i bild |
| `npm run phone:log` | Strömmar `[det]`/`[analyse]`-raderna med klocktid till `capture/<datum>/det-log.txt` |
| `node tools/grab.mjs <etikett>` | Sparar bildruta + maskbild + tillstånd i `capture/<datum>/NN-<etikett>/` |
| `node tools/reload.mjs "?debug&mask"` | Laddar om utan cache, säger vilket bygge som kom upp |
| `node tools/ev.mjs "<uttryck>"` | Kör JS i fliken |

Verktygen har aldrig körts mot en riktig telefon. Räkna med fem minuter
för första anslutningen. Fungerar de inte: Chrome på datorn →
`chrome://inspect` → telefonens flik → konsolen. Loggraderna är desamma.

**Fotopar är det som gör efterarbetet möjligt.** Ett `grab tom-tavla` och
ett `grab <felfall>` utan att stativet flyttats emellan låter hela kedjan
köras om offline. Ta ett nytt `tom-tavla` varje gång stativ, zoom eller ljus
ändrats.

### Rapporteringstakt

- **Del A–D: ett steg i taget.** De är grindar.
- **Del E–G: samla ihop.** Säg vad som såg konstigt ut, loggen läses
  efteråt.

Säg alltid **facit** när du kastar eller placerar: "pil i T20, vingen mot
vänster". Utan facit är en loggrad värdelös.

---

## Del A: riggen (5 min, inga pilar)

Två separata timmar har gått förlorade på att felsöka en app som inte
körde. Gör det här varje gång.

1. **Belysningsringen på.** Värd mer än all tröskeljustering.
2. **Stativ.** Handhållet överskrider rörelsetröskeln konstant.
3. **Bara EN Chrome-flik** med appen. En kvarglömd flik stjäl kameran tyst.
4. **Rätt bygge.** Efter push tar Pages ~2 min. Kontrollera hashen:
   `curl -s https://gkrallo.github.io/kps-dart-cam/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'`
   och jämför med det fliken kör. Ladda om med `reload.mjs` om de skiljer sig.
5. **`?debug&mask` i URL:en.** Utan `debug` loggar detektorn ingenting.
6. **Videon rullar.** `phone:check` mäter att `video.currentTime` ökar.
   Lita aldrig på debug-panelens siffror: de fryser på sina sista värden.
7. **Skalan:** tavlan ska vara ~800 px bred i bilden (≈2,4 px/mm). Vid 1×
   var den 365 px och pilblobbarna låg på gränsen att sållas bort.
8. **Tavlan tom** när spelet startas. Tom-tavla-referensen tas då.

---

## Del B: kalibreringen (10 min, inga pilar)

Allt nedan vilar på det här. Gå inte vidare förrän sektorlinjerna sitter på
tavlans riktiga trådar.

1. **Sikte-steget.** "Återställ", sedan "Sikte", hårkorset på bullen, "Zooma
   till tavlan". Hittar den tavlan? Rimlig zoom? Hyggliga startpunkter?
2. **Auto.** Ellipsmetoden inklusive automatisk sektorrotation.
3. **Döm av de streckade sektorlinjerna mot trådarna**, aldrig av
   wireframets form. På fotot från förra sessionen satt tavlan 2,5° snett.
4. **"Rikta in sektorer" (kompassikonen).** Dra medvetet punkterna några
   grader fel längs ringen, tryck, se om den snäpper tillbaka. Den ska säga
   hur många grader. Säger den att färgerna inte gick att läsa: mer ljus.
5. **"Spara kalibrering"**, ladda om sidan, kontrollera att BÅDE punkterna
   och zoomen kom tillbaka. Titta på `phone:check`-skalan igen.
6. Notera i loggen om `residual` skrivs ut någonstans; annars är det
   nästa sak att bygga (K2 i granskningen).

> Om del B inte går att få rätt: stanna här. Allt annat blir brus.

---

## Del C: flödet utan pilar (10 min)

Testar R3–R7, R13, ResumeCard. Knappa in pilar via pilraden (tryck en tom
ruta) om du inte vill kasta.

1. **501, två spelare.** Knappa in T20 T20 T20 → hör "Anders kastar. 320
   kvar." när tavlan töms (eller tryck "Avsluta tur" om den syns). Prompten
   växlar "Kasta, Anders" → "Dra ut pilarna" → "Kasta, Bertil".
2. **Tjock.** Spelare med 40 kvar: knappa in T20. Ska säga "Tjock! Dra ut
   pilarna." direkt och prompten ska bli "Dra ut pilarna". Knappa in en pil
   till → "Räknas inte", inget pil-ljud, inget nytt i pilraden.
3. **Farfar, två spelare.** Knappa 20 (mål 15) → "Anders: 20 poäng. 2
   sparade pilar. Bertil kastar. Mål 15, 3 pilar."
4. **Omladdning direkt** → återupptas tyst. **Peka en gång var som helst**
   på skärmen, knappa in en pil: ljud och tal ska fungera (R5). Utan
   pekningen är tystnad väntad, det är webbläsarens regel.
5. **Vänta 3 minuter, ladda om** → uppstartskortet med ställning och
   "senast spelad för 3 minuter sedan". Medan kortet visas: panelen under
   ska INTE synas (R6).
6. **"Byt spel"** → inställningarna, sedan "Tillbaka till matchen" → matchen
   är kvar (R7).
7. **Avsluta en match**, ladda om → "Spela igen, samma spelare".

---

## Del D: regression av vanliga kast (15 min)

**Det viktigaste steget.** Kastbanan har skrivits om tre gånger sedan den
senast fungerade live (uttagningsstack 09-11, avstämning 09-12, R1 09-18).

1. **En pil.** Rätt värde, rätt spelare, `AVSTÄMD/nytt kast` i loggen.
2. **Två pilar till**, en i taget. Rätt ordning i pilraden?
3. **Tio kast** spridda över yttre enkelfält, dubblar, tripplar. Skriv facit
   högt före varje kast. Notera för varje: rätt / fel fält / missad.
4. **R1-testet, viktigt:** kasta EN pil, se att den registreras. Kasta
   sedan en pil som du VET brukar missas (eller skym kameran med handen
   under kastet så den inte registreras). **Vänta 25 sekunder** utan att
   röra dig. Turen ska INTE avslutas. Förut kom "ingen pil avläst,
   ställningen står kvar" efter 15 s med pilarna kvar i tavlan.
5. Titta på `census=` i loggen. Står det `osäker` ofta: notera `why`. Det
   är den viktigaste enskilda diagnostiken den här sessionen.

**Godkänt:** ≥ 9 av 10 rätt i punkt 3, inget spökkast, inget falskt
turslut i punkt 4.

---

## Del E: precisionsmatris med handplacerade pilar (20 min)

Handplacering ger exakt facit utan kastspridning. Håll handen ur bild ≥ 2 s
efter varje placering. Läs av `VALT=…@…mm/…°` i loggen; radien och vinkeln
säger om ett fel är kalibrering (systematiskt, samma riktning) eller
spetsdetektering (slumpmässigt).

Fyll i tabellen. Ett kryss per cell, facit i vänsterkolumnen.

| Placering | Underlag för skaftet | Vingens riktning | Avläst | Radie mm | Rätt? |
|---|---|---|---|---|---|
| DB mitt | – | uppåt | | | |
| DB mitt | – | nedåt | | | |
| DB mitt, kraftigt lutad mot 6 | – | | | | |
| 25 nära 19/3-tråden | – | | | | |
| 25 nära 20/1-tråden | – | | | | |
| S20 inre (skaft över gräddvitt 1-fält) | gräddvitt | | | | |
| S20 yttre (skaft över svart ram) | svart | | | | |
| T20 mitt | | | | | |
| T20 1 mm från 20/1-tråden | | | | | |
| T20 1 mm från 20/5-tråden | | | | | |
| D20 mitt | | | | | |
| D20 1 mm innanför ytterkanten | | | | | |
| S6 (höger sida, kontroll av vänster/höger-asymmetrin från 09-12) | | | | | |
| S13, S10 | | | | | |
| S11 (vänster) | | | | | |
| S3 (botten) | | | | | |
| Pil i omgivningen, 175 mm (ska bli MISS) | | | | | |
| Pil på bordet under tavlan / i väggen (ska NTE registreras) | | | | | |
| Frontal pil (pekar rakt mot linsen) i S20 | | | | | |
| Pil med den andra uppsättningen (röd vinge) över gräddvitt | | | | | |

Vid varje fel: `node tools/grab.mjs <etikett>` medan pilen sitter kvar.
Med `?debug` ska `delar=2` synas när fragmentgrupperingen slog ihop
pipa + vinge, och `bbox` ska vara hela pilen (~250×115) och inte en ensam
vinge (~110×110).

**Godkänt:** DB skiljs från 25 i alla tre bull-fallen (Farfar kräver det),
inga fel utanför ±1 fält vid trådarna, ingen registrering i de två sista
negativa fallen.

---

## Del F: uttagning, avstämning, dold pil (15 min)

Kör i ordning, stanna vid första felet.

1. **Ren uttagning.** Tre vanliga pilar, dra ut en i taget med paus. Tavlan
   ska nå tom utan spökkast. Loggen: `AVSTÄMD/uttagning`.
2. **Valfri ordning.** Dra ut i annan ordning än kastad. Ska inte påverka
   någonting.
3. **Slarvig uttagning.** Ryck ut alla tre i ett svep. Säkerhetsnätet
   "tavlan tom" ska ta över.
4. **Dold pil.** Kasta/placera två pilar så att den ena kroppen skymmer den
   andras spets sett från kameran, med spetsarna > 15 mm isär. De ska
   registreras som EN. Dra ut den som räknades (den framför). "Dold pil
   hittades: …" ska komma och pilraden växa. Spetsar närmare än ~13 mm
   förkastas av avståndsspärren: det är spärren som jobbar, inte ett fel.
5. **Dold pil i Farfar (R2).** Farfar, mål 15: placera en 5:a, en 5:a skymd
   bakom, och en 10:a. Appen ser [5, 10] = 15, stänger turen med 1 sparad
   pil. Dra ut den framförvarande 5:an → den dolda hittas → A ska ha **0
   sparade** och B ska inte ha någon pil i sin rad. Förut hamnade den hos B.
6. **Arm i bild utan kast.** Sträck dig in mot tavlan, dra tillbaka. Inget
   ska registreras; inget turslut (armen är där < 3 s).
7. **Arm i bild länge.** Håll handen i tavlan i 5 s, dra tillbaka. Hände
   inget kast är detta ett känt gränsfall: kan ge "tur utan avläst pil".
   Notera vad som händer.

---

## Del G: svårigheter, om tiden räcker (15 min)

Oberoende observationer; kör och samla.

1. **Snabba kast (D1 i granskningen).** Tre pilar inom ~3 s. Registreras
   alla tre? Hypotesen är att pil 2 tappas om den landar < 1 s efter pil 1.
2. **Pilar tätt ihop.** Samma sektor, olika ringar (S20 och T20). Två kast?
3. **Pilar som överlappar i bild men inte skymmer spetsen (D2).** Kasta pil
   2 så att dess kropp korsar pil 1:s kropp. Blir pil 2:s fält rätt?
4. **Ljusändring.** Låt någon gå mellan lampan och tavlan medan pilar
   sitter i. Spökkast? Falskt turslut?
5. **Knuff på stativet.** Peta lätt på telefonen. Blir kalibreringen kvar
   användbar? Hur ser man att den gled? (Det finns ingen varning i dag.)
6. **Appbyte mitt i tur.** Hem-skärmen 10 s och tillbaka med pilar i
   tavlan. Videon ska rulla vidare, pilarna ska fortfarande vara
   registrerade, uttagningen ska fungera.
7. **Omladdning med pilar i tavlan (D4).** Ladda om mitt i en tur, dra sedan
   ut pilarna. Hypotes: hålen registreras som kast för nästa spelare.
8. **Bounce-out.** Kasta så pilen faller ur (eller placera och dra ur
   direkt). Registrerades ett kast? Försvann det?
9. **Hel Farfar-runda, tre spelare**, utan att röra telefonen, med en
   utslagning. Hörs allt som behövs från linjen?

---

## Om något går fel

1. **Säg vad du gjorde** och ungefär när ("tredje pilen, skulle vara T20").
   Raden finns i `capture/<datum>/det-log.txt` med area, bbox, konturantal,
   elongation, axelkonfidens, skuggtest, avstämningsutfall och `VALT`.
2. **`node tools/grab.mjs <etikett>`** direkt, medan pilen sitter kvar, plus
   ett `tom-tavla`-par från samma uppställning.
3. Fixturerna från 09-12 är skälet till att en hel arbetsdag kunde göras
   utan tavla. Det är billigt att ta för många.

Efter sessionen, i ordning: korrigeringslogg, Farfar-turgränser (beslut),
kameralås, finjustering på ringkanter, spelläge för 2,4 m. Skälen står i
`GRANSKNING.md` avsnitt 7.
