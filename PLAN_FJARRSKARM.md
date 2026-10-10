# Plan: Fjärrskärm (svar på PROMPT_FJARRSKARM.md)

Skriven 2026-10-09 efter genomgång av koden. Inget är byggt. Godkänn,
ändra eller stryk innan arbetet börjar. Arbetet sker på grenen
`fjarrskarm`; `main` (och därmed Netlify) rörs inte förrän en fas är klar
och testad.

## Varför

Kamerastativet gungar när man rör telefonen (Kristian 2026-10-09), och en
rättning på skärmen har redan en gång flyttat bilden så mycket att
kalibreringen fick göras om. Fjärrskärmen låter all rättning ske på en
annan enhet. **Snabbaste lösningen redan nu, utan kod:** `scrcpy` på datorn
speglar och styr telefonen via USB-kabeln som redan sitter i.

## Det viktigaste avsteget från specifikationen

Specifikationen förutsätter en eventlogg som bara växer, med ett
sekvensnummer per event. **Så ser matchen inte ut i koden.** `match.actions`
är kastlistan, men rättningar ändrar den på plats: `replaceThrow`,
`insertThrow` och `removeThrow` (src/game/match.ts) arbetar på ett index
mitt i listan. Ett sekvensnummer per post skulle förskjutas vid varje
insättning.

**Förslag:** synka hela matchen med ett versionsnummer i stället för enskilda
event.

- Host håller `version` (heltal, ökar vid varje ändring) och skickar
  `{ matchId, version, match }` - den serialiserade matchen, några kB - till
  alla remotes efter varje ändring. På LAN över en datakanal är det
  försumbart.
- Remote kör samma `matchState()` på sin kopia, så tillståndet räknas fram
  med exakt samma regelmotor (specifikationens krav uppfyllt).
- Idempotens och luckor försvinner som problem: remote tar alltid den högsta
  versionen den sett. En remote som återansluter får den aktuella matchen i
  första meddelandet.
- Ändringsförslag från remote är operationer med samma namn som i useMatch:
  `throw`, `replace(ai, seg)`, `insert(ai, seg)`, `remove(ai)`, `undo`,
  `endTurn`. Host kör dem genom samma funktioner som sin egen skärm (och
  rättningsloggen) och svarar med ny version eller `reject`.
- Förslaget bär `baseVersion`. Har host ändrats sedan dess (en pil landade
  medan någon rättade) avvisas förslag som pekar på index - remote visar
  "matchen ändrades, försök igen" i stället för att rätta fel pil.

## Svar på de öppna frågorna (avsnitt 11)

1. **Sekvensnummer:** se ovan - versionsnummer på hela matchen.
2. **Var bilden tas:** i `registerNewThrow`/`revealDart` i useDartDetector,
   där råbild och spets finns samtidigt. Beskärningen kopierar en ROI direkt;
   JPEG-kodningen (canvas `toBlob`) körs efteråt i en `setTimeout(0)`, aldrig i
   analyssteget.
3. **QR-läsning på host:** `BarcodeDetector` (finns i Android Chrome). Den
   självhostade opencv.js är inte kontrollerad för `QRCodeDetector` - används
   inte. Fallback "klistra in kod".
4. **Ljud från remote:** nej, ljudet stannar på host.
5. **Kodsplittning:** `main.tsx` väljer mellan `App` och en ny `RemoteApp`
   med `React.lazy` utifrån `?remote`. Remote importerar aldrig CameraFeed,
   useOpenCV eller useDartDetector, så opencv.js laddas aldrig. Enhetsläget
   får en extra lazy-gräns runt App, i övrigt oförändrat.
6. **Host laddas om mitt i match:** datakanalen dör; remote visar
   "Frånkopplad - visar senast kända läge" och låser rättning. Parkoppla om.
   Känd begränsning, dokumenteras.

## Beroenden - beslut för Kristian

CLAUDE.md säger "inga produktionsberoenden utöver React och lucide-react".
Fjärrskärmen behöver två:

- **QR-generering** (det finns inget webbläsar-API för att RITA en QR-kod):
  `qrcode-generator`, MIT, ca 20 kB, inga egna beroenden.
- **QR-läsning på iPhone/iPad** (Safari saknar `BarcodeDetector`): `jsQR`,
  Apache 2.0, ca 45 kB. Laddas bara på remote och bara om
  `BarcodeDetector` saknas.

Alternativ utan beroenden: ingen QR alls, bara "kopiera kod / klistra in" -
fungerar men är klumpigt (koden är ca 1 000-1 500 tecken). Rekommendation:
ta in båda.

Service worker (fas 0) använder `vite-plugin-pwa` som dev-beroende.

## Faser

Samma som specifikationen, en commit per fas, tester gröna efter varje.

| Fas | Innehåll | Ny kod | Testas med |
|---|---|---|---|
| 0 | Service worker, precache inkl. opencv.js, "ny version finns", byggversion i debug-panelen | `vite.config.ts`, liten `UpdateBanner` | Netlify-deployen, offline-start |
| 1 | Synk-lager utan UI: `Transport`, `LoopbackTransport`, meddelanden, host-validering, remote-kopia | `src/remote/` (protokoll, host, remote, loopback) | Vitest: konvergens, återanslutning, `reject`, nytt `matchId`, fördröjning/omkastning |
| 2 | WebRTC + parkoppling: SDP-minifiering och komprimering, QR visa/läsa, flödet på båda sidor | `webRtcTransport.ts`, `sdp.ts`, `PairingView` | Vitest för SDP-rundgång; manuellt testfall i TESTPLAN |
| 3 | Remote-gränssnittet: resultattavla läsbar från 2,4 m, rättning, Turer, ångra, Wake Lock, status | `RemoteApp.tsx` + vyer, återanvänder `ThrowEditor`/`TurnHistory` | Rök-test som gameViews; manuellt |
| 4 | Bild per kast: beskärning, `frame`, ringbuffert, rättningsvy med bild och renderad tavla | hook i detektorn, `RemoteThrowView` | Manuellt vid tavlan |
| 5 | Dokumentation: AGENT, CLAUDE, README, TESTPLAN | - | - |

Fas 0 och 1 går att göra helt utan tavla. Fas 2 behöver två enheter på samma
wifi (telefonen + surfplatta eller dator). Fas 4 behöver tavlan.

## Risker

- **Parkoppling i ett gästnät/isolerat wifi** (klienter får inte prata med
  varandra): WebRTC med bara host-kandidater fungerar då inte, och utan
  server finns ingen utväg. Hemma är det normalt inget problem.
- **QR-läsning med kameran som sitter i stativet:** remote måste hållas upp
  framför tavlan. Görs före kalibreringen, så stativet hinner inte knuffas
  efteråt.
- **Telefonens prestanda:** bildkodningen per kast (~40 kB JPEG) är billig,
  men måste mätas - detektorn går redan i 6-17 fps.
- **Två som rättar samtidigt:** löses av `baseVersion` ovan.

## Omfattning

Grovt 3-5 arbetspass. Fas 0-1 kan göras en kväll när tavlan inte är
tillgänglig.

## Tillägg efter första enhetstestet 2026-10-09

Kameran (Galaxy S25) och fjärrskärmen (Samsung-surfplatta) i Chrome på
samma wifi. Parkopplingen fungerade efter att fjärrsidan fick be om
kameran (07d3763, riktiga adresser i stället för *.local). Kristians
synpunkter, byggda 2026-10-10:

1. **Starta en match från fjärrskärmen.** Nytt kommando `startMatch` med
   det GameSetup ger. Kameran kör samma `useMatch.start` som sin egen
   GameSetup och "Spela igen, samma spelare", stänger sina egna
   inställnings- och fortsätt-kort, och detektorn är av så länge de
   visas, som förut. På fjärrskärmen: inställningarna (GameSetup,
   förifylld med förra matchens spelare) när ingen match pågår eller den
   är avgjord, "Spela igen" efter en avgjord match och "Ny match" med
   bekräftelse under en match.
2. **Kalibrering från fjärrskärmen** - viktigast, fästet gungar när man rör
   telefonen. Kommandon `calibrate {open | auto | save | cancel}` och
   `confirmEmpty`, utförda med kalibreringsvyns egna hanterare (ingen
   ändring av kalibreringsmatematik, Auto eller detektor). Kameran
   rapporterar sitt läge (`hostState`: kalibrerar, steg, statusrad, "Dra
   ut alla pilar"-frågan) och skickar under kalibreringen en
   **förhandsbild** (`calPreview`): kamerans bild med tavlans wireframe,
   så att man på surfplattan ser att de streckade linjerna ligger på
   trådarna. Fjärrskärmen har en Kalibrering-vy med bilden, statusraden
   och Kalibrera om / Auto / Spara / Avbryt, och svarar "Tavlan är tom".
3. **Spelarlistan visar senaste turens pilar**, t.ex. "Spelare 1
   (T20 · T20 · Miss) 356" - samma etiketter som pilraden. Den som står
   på tur visar den pågående turen. Farfar: rundans pilar, och de
   Farfar-specifika siffrorna står kvar.
4. Dessa krav här och i TESTPLAN Del H.
5. **Helskärmsknapp** på fjärrskärmen (Fullscreen API, dold där den saknas
   eller inte behövs), och ett eget manifest för `?remote` så att en
   fjärrskärm som installeras på hemskärmen öppnar fjärrskärmen - i
   helskärm och valfri riktning - och inte kameraappen.

**Utredning: turerna bytte inte av sig själva vid testet.** "Nästa
spelare" från fjärrskärmen fungerade. En mekanism på grenen som stämmer:
efter en parkoppling med kalibrerad kamera startade detektorn om efter
fasta 5 s, och varje omstart tar bilden som den är som "tom tavla". Stod
surfplattan eller personen kvar i bild blev referensen fel och tömningen
kändes aldrig igen. Åtgärdat: detektorn väntar nu på "Tavlan är tom"
(besvarbar från fjärrskärmen). Inte bevisat att det var orsaken - det
beror på om parkopplingen gjordes efter kalibreringen. Kör om TESTPLAN
H6 och H19.
