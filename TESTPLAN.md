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

## Så här kör vi — utan att röra telefonen

Telefonen ansluts över USB (utvecklarläge + USB-felsökning påslaget), och då
läses allt från datorn. **Du ska aldrig behöva kopiera en loggrad eller flytta
en bild ur mobilens galleri.** Vill du slippa kabeln: `adb tcpip 5555` följt av
`adb connect <telefonens-ip>:5555`, så funkar det över wifi och Samsung Flow
kan ha skärmen samtidigt.

| Kommando | Vad det gör |
|---|---|
| `npm run phone:check` | Steg 0 nedan, automatiskt: telefon, bygge, `?debug`, att videon rullar, och hur stor tavlan är i bild |
| `npm run phone:log` | Strömmar `[det]`/`[analyse]`-raderna med klocktid, och sparar dem i `capture/<datum>/det-log.txt` |
| `node tools/grab.mjs <etikett>` | Sparar videobildruta + maskbild + tillstånd i `capture/<datum>/NN-<etikett>/` |
| `node tools/reload.mjs "?debug&mask"` | Laddar om utan cache och säger vilket bygge som kom upp |
| `node tools/ev.mjs "<uttryck>"` | Kör JS i fliken — läs av vad som helst utan att trycka på skärmen |

**Kör igång så här, en gång i början:**

```bash
npm run phone:check          # åtgärda allt den klagar på först
npm run phone:log            # låt den ligga och rulla i ett eget fönster
```

Sedan räcker det att du säger vad du gör — *"nu kastar jag tre i 20:an"* — så
läses resultatet ur loggen. Ingen avskrift.

### Att spara undan material

`node tools/grab.mjs <etikett>` hämtar **exakt den bildruta appen matar in i
sin egen kedja**, i samma format som fixturerna vi redan har (JPEG 0,92). Det
är därför bilderna inte behöver gå via mobilens galleri.

**Fotoparet är det som gör efterarbetet möjligt.** Ett par betyder: en
`grab` med **tom tavla** och en med **felfallet**, utan att flytta stativet
emellan. Då går hela diffkedjan att köra om offline — det var precis så hela
förra arbetsdagen kunde göras utan tavla.

```bash
node tools/grab.mjs tom-tavla            # innan pilarna sitter i
# ... kasta / handplacera ...
node tools/grab.mjs pil-i-20-las-som-18  # direkt när något blir fel
```

Ta ett nytt `tom-tavla` varje gång stativet, zoomen eller ljuset har ändrats —
ett par med olika framing är värdelöst.

`capture/` är gitignorerad. Det som visar sig vara värt att behålla flyttas
medvetet in som fixtur under `src/utils/__tests__/fixtures/` efteråt.

### Rapporteringstakt

- **Steg 0–3: ett steg i taget.** De är grindar. Sitter kalibreringen fel är
  all mätdata därefter brus, och går något sönder i steg 3 ska det fixas innan
  du kastar mer.
- **Steg 4–8: samla ihop.** De är oberoende observationer. Kör igenom dem och
  säg vad som såg konstigt ut, så läses loggen i efterhand.

---

## Steg 0 — riggen, innan någonting annat (5 min)

Två separata timmar har gått förlorade på att felsöka en app som inte körde.
Gör det här varje gång.

0. **`npm run phone:check`** gör punkt 3–6 nedan åt dig och säger vad som är fel.
   Punkt 1 och 2 måste du göra själv.
1. **Belysningsringen på.** Den är värd mer än all tröskeljustering: konturerna
   i masken gick från ~500 till 11, och bullen från 13 mm fel till 2 mm.
2. **Stativ.** Handhållet överskrider rörelsetröskeln konstant och då
   registreras ingenting.
3. **Rätt bygge.** `phone:check` jämför fliken mot det publicerade bygget.
   Ligger det efter: `node tools/reload.mjs "?debug&mask"`.
4. **`?debug&mask` i URL:en.** Utan `debug` loggar detektorn ingenting alls;
   `mask` behövs för att `grab` ska få med maskbilden.
5. **Kontrollera att videon faktiskt rullar** — `phone:check` mäter att
   `video.currentTime` ökar. Lita aldrig på debug-panelens siffror: de fryser
   på sina sista värden och en frusen bild ser precis ut som en lugn tavla.
6. **Kontrollera skalan efter kalibrering:** tavlan ska vara ~800 px bred i
   bilden (≈2,4 px/mm) — `phone:check` räknar ut det ur den sparade
   kalibreringen. Vid 1× var den 365 px och pilblobbarna låg precis på gränsen
   att sållas bort som för små.
7. **Bara EN Chrome-flik får ha appen öppen.** En kvarglömd flik stjäl kameran
   tyst och ger svart bild med en ström som påstår sig vara `live`.
   `phone:check` varnar om den hittar flera.

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

Loggen fångas redan av `phone:log`. Det enda du behöver göra:

1. **Säg vad du gjorde** och ungefär när ("tredje pilen, skulle vara T20").
   Raden finns redan i `capture/<datum>/det-log.txt` med klocktid — den
   innehåller area, bbox, antal konturer, elongation, axelkonfidens,
   skuggtest, avstämningens utfall och vilken punkt som faktiskt blev poängen.
2. **`node tools/grab.mjs <etikett>`** direkt, medan pilen sitter kvar. Och ett
   `tom-tavla`-par om det inte redan finns ett från samma uppställning.

Fixturerna från förra sessionen är anledningen till att en hel arbetsdag kunde
göras utan tavla — de bevisade silverskaftshypotesen fel och ledde till rätt
fix. Det är billigt att ta för många och dyrt att sakna ett.

Efter sessionen: stryk `?debug`-instrumenteringen ur `useDartDetector.ts` om
detekteringen står sig, och gå vidare med rättnings-UX (missmarkering,
turordning, kasta om för att läsa om).
