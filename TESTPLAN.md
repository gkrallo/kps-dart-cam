# Testplan för nästa session vid tavlan

Skriven 2026-09-12, efter en dag med bara offline-arbete. Sedan senaste
hårdvarusessionen har **sex saker byggts som aldrig sett ett riktigt kast**.
Den här listan är ordnad så att det som allt annat vilar på testas först, och
så att ett fel går att lokalisera i stället för att bara konstateras.

Räkna med **60–90 minuter**. Hoppa hellre över steg 8 än att slarva med steg 1.

---

## Vad som är otestat

| Vad | Var | Byggt |
|---|---|---|
| Sikte-steget (autozoom mot tavlan) | `CalibrationOverlay` | 2026-09-11 |
| Omvänd uttagning + avslöjande av dold pil | `useDartDetector` | 2026-09-11 |
| Varning om missad pil + `TurnHistory` | `App`, `TurnHistory` | 2026-09-11 |
| Kamerafix vid appbyte + wake lock | `CameraFeed` | verifierad utan pilar |
| **Fragmentgruppering** (silverskaftet) | `blobGroups.ts` | 2026-09-12 |
| **Automatisk sektorrotation** | `sectorPhase.ts` | 2026-09-12 |
| **Positionsbaserad avstämning** | `dartCensus.ts` | 2026-09-12 |
| **Spelflödet**: tur utan avläst pil, statusrad, uppstartskort | `App`, `Scoreboard`, `ResumeCard` | 2026-09-12 |

---

## Steg 0 — riggen, innan någonting annat (5 min)

Två separata timmar har gått förlorade på att felsöka en app som inte körde.
Gör det här varje gång.

1. **Belysningsringen på.** Den är värd mer än all tröskeljustering: konturerna
   i masken gick från ~500 till 11, och bullen från 13 mm fel till 2 mm.
2. **Stativ.** Handhållet överskrider rörelsetröskeln konstant och då
   registreras ingenting.
3. **Rätt bygge.** `curl -s https://gkrallo.github.io/kps-dart-cam/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'` och jämför med fliken på telefonen. Ladda om vid behov.
4. **`?debug` i URL:en.**
5. **Kontrollera att videon faktiskt rullar** — `video.currentTime` ska öka.
   Lita aldrig på debug-panelens siffror: de fryser på sina sista värden och en
   frusen bild ser precis ut som en lugn tavla.
6. **Kontrollera skalan efter kalibrering:** tavlan ska vara ~800 px bred i
   bilden (≈2,4 px/mm). Vid 1× var den 365 px och pilblobbarna låg precis på
   gränsen att sållas bort som för små.

---

## Steg 1 — kalibreringen (10 min, inga kast)

**Allt nedanför vilar på det här. Gå inte vidare förrän sektorlinjerna sitter
på tavlans riktiga trådar.**

1. **Sikte-steget.** "Återställ", sedan "Sikte". Sikta så hårkorset ligger på
   bullen, tryck "Zooma till tavlan". Hittar den tavlan? Blir zoomen rimlig?
   Blir startpunkterna hyggliga?
2. **Auto-Kalibrera.** Ellipsmetoden, som numera också vrider sektorhjulet
   automatiskt ur ringarnas röd/grön-växling.
3. **Döm av de streckade sektorlinjerna mot de riktiga trådarna** — aldrig av
   wireframets form. Formen kan följa dubbelringen perfekt medan hela hjulet är
   vridet. På fotot från förra sessionen satt tavlan 2,5° snett.
4. **"Rikta in sektorer".** Dra medvetet punkterna några grader fel längs
   ringen, tryck på knappen, och se om den snäpper tillbaka. Den ska säga hur
   många grader den vred. Säger den att färgerna inte gick att läsa: mer ljus.

> Om steg 1 inte går att få rätt — stanna här och felsök det. Allt annat blir
> meningslöst mätdata.

---

## Steg 2 — uppstartsflödet (5 min, inga kast)

1. Starta ett 501-spel, kasta eller knappa in ett par pilar.
2. **Ladda om sidan direkt.** Ska återuppta tyst, utan fråga.
3. Vänta 3 minuter, ladda om igen. Ska nu visa **kortet** med ställningen,
   vem som står på tur och "senast spelad för 3 minuter sedan".
4. "Nytt spel" från kortet ska gå till spelinställningarna.
5. Spela klart en match (eller knappa fram en vinst) och ladda om: ska erbjuda
   **"Spela igen, samma spelare"**, inte "Fortsätt".

---

## Steg 3 — regression: vanliga kast (15 min)

**Det viktigaste steget.** Kastbanan har skrivits om två gånger sedan den
fungerade: först för omvänd uttagning (2026-09-11), sedan för avstämningen
(2026-09-12). Om något tyst har gått sönder är det här det syns.

1. En pil. Registreras den, med rätt värde, på rätt spelare?
2. Två pilar till, en i taget. Rätt ordning i pilrutorna?
3. En handfull kast i yttre enkelfält, plus några dubblar och tripplar.
4. Titta på `?debug`-raden för varje kast: den ska säga `AVSTÄMD/nytt kast`.
   Står det `census=osäker` ofta — notera vad `why` säger, det är den
   viktigaste enskilda diagnostiken vi kan få ut den här sessionen.

---

## Steg 4 — silverskaftet (10 min)

Det uppmätta felfallet: pilen faller isär i pipa + vinge, och förut vann vingen
(198 px fel → `S18` där sanningen var 20).

1. **Handplacera** en pil så att skaftet ligger över ett **gräddvitt** fält
   (inre 20 fungerade förra gången). Rätt sektor nu?
2. Samma pil så att skaftet ligger över **svart** — kontrollfallet som alltid
   fungerat.
3. I `?debug`: `delar=2` betyder att grupperingen slog ihop bitarna, och `bbox`
   ska vara hela pilen (~250×115) i stället för en ensam vinge (~110×110).
4. Om möjligt: prova den **andra uppsättningen pilar** (röd vinge, svart spets)
   över ett gräddvitt fält. Då vet vi om felet är färgberoende eller allmänt.

---

## Steg 5 — bullen (10 min)

Den enda kvarvarande frågan från förra sessionen.

1. **Riktiga kast** i DB/25, inte handplacerade. Skiljs DB (50) från 25?
   Farfar kräver det.
2. **Grön 25 nära en sektorgräns** — det ursprungliga felet, fortfarande
   overifierat. En 25 nära 19-gränsen lästes en gång som 18.
3. Läs av radien i debug-raden: `DB@2mm` är bra, `25@13mm` är den gamla
   felbilden och betyder kalibrering, inte detektering.

---

## Steg 6 — uttagning och avstämning (15 min)

Kör i den här ordningen, och stanna vid första felet.

1. **Ren uttagning.** Tre vanliga pilar, dra ut dem en i taget med en paus
   emellan. Tavlan ska nå tom utan spökkast på vägen.
2. **Fel ordning.** Dra ut den som kastades FÖRST först. Det här gick inte
   förut (stacken antog sist-först) och ska fungera nu.
3. **Dold pil.** Kasta två pilar så att de smälter ihop till en blobb sett från
   kameran — de registreras som EN. Dra sedan ut den främre. Kommer
   "Dold pil hittades", och växer pilraden med rätt värde på rätt plats?
   **OBS:** spetsarna måste sitta mer än ~15 mm isär, annars förkastas den
   avslöjade pilen av avståndsspärren. Det är spärren som gör sitt jobb, inte
   ett fel.
4. **Slarvig uttagning.** Ryck ut alla tre i ett svep. Ska ändå landa rätt via
   säkerhetsnätet "tavlan tom".

---

## Steg 7 — flödet utan att röra skärmen (15 min)

Målet: en hel omgång utan att gå fram till telefonen.

1. **En hel 501-tur.** Hör varje pil, sedan "X poäng, Y kvar", sedan "nästa
   spelares tur". Statusraden ska växla mellan "Kasta, *namn*" och
   "Dra ut pilarna".
2. **En hel Farfar-runda.** Poäng plus antal sparade pilar (eller "utslagen"),
   sedan nästa spelares tur.
3. **Turen utan avläst pil.** Skym kameran medan du kastar tre pilar så att
   ingenting registreras, dra sedan ut dem. Spelaren ska ändå bytas, med
   "ingen pil avläst, ställningen står kvar". Det här hängde sig helt förut.
   I Farfar ska den i stället varna om att fylla i pilarna via Turer.
4. **"Avsluta tur" ska INTE synas** under normalt spel. Den dyker upp först
   efter 35 sekunders väntan på uttagning, eller när pilar saknas.
5. **Missad pil.** Avsluta en 501-tur med bara 2 av 3 avlästa: uppläst varning,
   gul banner, och "Lägg till" som öppnar `TurnHistory`. Sätt in pilen på rätt
   plats och kontrollera att ställningen räknas om.

---

## Steg 8 — om tiden räcker

- **Snabba kast:** tre pilar inom ~5 s. Äter 1-sekundersspärren en riktig pil?
- **Pilar tätt ihop:** samma sektor, olika ringar. Två kast eller ett?
- **Arm i bild:** sträck dig in mot tavlan utan att kasta. Ska inte ge pil.
- **Appbyte:** hem-skärmen i 10 s och tillbaka. Videon ska rulla vidare.
  (Verifierad utan pilar 2026-09-12, men inte mitt i ett spel.)

---

## Om något går fel

Två saker är guld värda och tar en minut:

1. **Kopiera `?debug`-raden** för det misslyckade kastet. Den innehåller area,
   bbox, antal konturer, elongation, axelkonfidens, skuggtest, avstämningens
   utfall och vilken punkt som faktiskt blev poängen.
2. **Ta ett foto med appens egen kamera** av (a) den tomma tavlan och (b)
   felfallet, utan att flytta stativet emellan. Fixturerna från förra sessionen
   är anledningen till att hela dagens arbete kunde göras utan tavla — de
   bevisade silverskaftshypotesen fel och ledde till rätt fix.

Efter sessionen: stryk `?debug`-instrumenteringen ur `useDartDetector.ts` om
detekteringen står sig, och gå vidare med rättnings-UX (missmarkering,
turordning, kasta om för att läsa om).
