# Uppdrag: Fjärrskärm för KPs DartCam

Du arbetar i repot `gkrallo/kps-dart-cam`. Uppgiften är att lägga till stöd för en
**fjärrskärm**: en andra enhet (surfplatta, laptop, annan telefon — inklusive iPhone)
som visar matchen, låter spelarna rätta felavläsningar, ångra, sätta in missade pilar
och starta om leg — utan att någon behöver röra kameraenheten.

Det här dokumentet är hela specifikationen. Läs det i sin helhet innan du gör något.

---

## 0. Arbetssätt

1. **Läs först** `AGENT.md`, `CLAUDE.md`, `README.md`, `TESTPLAN.md` och `GRANSKNING.md`.
   Kartlägg sedan i koden: hur eventloggen och regelmotorn är uppbyggda, hur ett kast
   blir ett event, hur rättning och "sätt in missad pil" fungerar idag, hur matcher
   sparas och återupptas, hur `opencv.js` laddas, och hur UI:t är strukturerat.
2. **Presentera en plan** innan du skriver kod: vilka moduler som berörs, vilka nya
   moduler du tänker skapa, och hur du tänker svara på de öppna frågorna i avsnitt 11.
   Vänta på godkännande.
3. Arbeta i en **egen branch** (t.ex. `fjarrskarm`). `main` deployar automatiskt till
   GitHub Pages och ska förbli körbar hela tiden.
4. Genomför i **faserna i avsnitt 9**, en commit per fas. Alla befintliga tester ska
   vara gröna efter varje fas. Kör `npm test` och `npm run lint` innan varje commit.
5. **Rör inte** detektering, kalibrering, spetsdetektering, avstämning eller
   geometrin. De är fintrimmade mot riktig hårdvara och ligger utanför uppdraget.
   Om du tror att något där måste ändras: stanna och fråga.
6. Uppdatera `AGENT.md` (arkitektur), `CLAUDE.md` (fallgropar och mätvärden),
   `README.md` (användarens perspektiv) och `TESTPLAN.md` (manuell testgenomgång)
   som en del av arbetet, inte efteråt.
7. Följ befintliga konventioner: TypeScript strict, Vitest, React 19, Tailwind v4,
   svenska i användartext och dokumentation.

---

## 1. Icke förhandlingsbara principer

Dessa är hämtade ur projektets egna README och gäller för allt du bygger:

- **Ingen server, ingen backend, inga API-nycklar, ingen löpande kostnad.**
  Lösningen ska fungera helt lokalt mellan enheterna. Ingen signaleringsserver,
  inget relä, ingen STUN/TURN-tjänst.
- **Kamerabilder lämnar aldrig telefonen** — med det avsteget att en beskuren
  bild av träffområdet får skickas till en fjärrenhet som användaren själv
  parkopplat, och bara över den krypterade peer-to-peer-kanalen.
- **Enhetsläget ska fungera exakt som idag.** Fjärrskärmen är ett tillägg. Ingen
  del av spelet får kräva att en fjärrenhet finns. Ingen befintlig funktion får
  bli sämre eller långsammare för den som spelar med bara en telefon.
- **Kameraenheten är auktoritativ.** Eventloggen på kameraenheten är sanningen.
  Fjärrenheten föreslår event; kameraenheten validerar via regelmotorn, lägger
  till, och sprider. Ingen konfliktlösning, ingen dubbel sanning.
- **Ingenting under spelets gång ska kräva att man rör kameraenheten.** Varje
  tryck på den är en chans att knuffa stativet. Det är hela motivet för
  funktionen.
- **Fortsatt GitHub Pages.** Base path `/kps-dart-cam/`, statisk hosting, inga
  serverfunktioner. Om något i din plan kräver annan hosting är planen fel.

---

## 2. Teknisk begränsning som avgör transportvalet

Appen serveras över HTTPS eftersom `getUserMedia` kräver secure context. Från en
secure context blockerar webbläsaren mixed content: **det går inte att öppna
`ws://` eller `http://` mot en LAN-adress.** Lokala HTTP-servrar, lokala
WebSocket-reläer och alla varianter av "surfa till telefonens IP" är därmed
uteslutna redan av webbläsaren.

**WebRTC `RTCDataChannel` är undantaget** — den är DTLS-krypterad av konstruktion
och tillåten från secure context. Den är också den enda transporten som uppfyller
principen om ingen server. Använd den, med enbart host-kandidater (ingen
`iceServers`-lista). På samma LAN räcker det. Chrome och Safari döljer lokala
IP-adresser bakom mDNS-namn (`.local`) i kandidaterna; det fungerar på samma nät
och är inget du ska försöka kringgå.

Signaleringen (utbytet av SDP) sker via **QR-koder**, se avsnitt 5.

---

## 3. Arkitektur i tre lager

Bygg tre tydligt separerade lager. Varje lager ska gå att testa utan de andra.

### 3.1 Synk-lagret: replikering av eventloggen

Projektet har redan en event-sourcad regelmotor. Använd den — bygg **inte** en
parallell tillståndsmodell.

- Kameraenheten (nedan **host**) tilldelar varje event ett **sekvensnummer**:
  heltal, monotont växande, utan luckor, per match. Om eventloggen redan har en
  ordning, återanvänd den; annars lägg till sekvensnumret som ett tunt lager
  runt befintlig logg utan att ändra eventens form.
- Varje match har ett **`matchId`** (UUID, skapas när matchen skapas). Alla
  meddelanden bär `matchId`. En fjärrenhet som får ett annat `matchId` än den
  har lokalt tömmer sin lokala kopia och synkar om från noll — det förhindrar
  att en gammal match blandas med en ny.
- Fjärrenheten (nedan **remote**) håller en **lokal kopia av eventloggen** och kör
  **samma regelmotor** (samma reducer, samma kod) för att räkna fram tillstånd.
  Ingen tillståndsserialisering skickas i normalfallet — bara event.
- Remote sparar sin logg i `localStorage` (eller det projektet redan använder) så
  att en omladdning inte tömmer resultattavlan, och begär vid återanslutning
  "allt från sekvensnummer N".
- Om remote upptäcker en lucka i sekvensnumren begär den omsynk från senaste
  sammanhängande nummer.

### 3.2 Transport-lagret

Definiera ett litet gränssnitt, ungefär:

```ts
interface Transport {
  send(msg: WireMessage): void;
  onMessage(cb: (msg: WireMessage) => void): () => void;
  onStateChange(cb: (s: 'connecting' | 'open' | 'closed') => void): () => void;
  close(): void;
}
```

Två implementationer:

- **`LoopbackTransport`** — två instanser i samma process, kopplade till
  varandra, för tester. Ska kunna injicera fördröjning, omkastad ordning och
  tappade meddelanden.
- **`WebRtcTransport`** — `RTCPeerConnection` + en `RTCDataChannel`
  (`ordered: true`). Ingen `iceServers`. Icke-trickle: vänta på
  `iceGatheringState === 'complete'` innan SDP hämtas ut, så att hela
  erbjudandet ryms i en QR-kod.

Synk-lagret ska bara känna till `Transport`, aldrig WebRTC.

### 3.3 Roller och UI

- **Host** = kameraenheten. Allt som finns idag, plus ett parkopplingssteg och en
  diskret indikator "fjärr ansluten (n)". Ljud och uppläsning fortsätter på host.
- **Remote** = fjärrenheten. Nås via `?remote` i URL:en (samma mönster som
  `?debug`; Pages har ingen serverside-routing, så ingen path-baserad routing).
  Remote laddar **inte** kamera, **inte** OpenCV.js och **inte** detektering.
  Se avsnitt 7.

---

## 4. Protokoll

JSON över datakanalen. Alla meddelanden bär `matchId` och `v: 1`. Föreslagen
meddelandemängd — anpassa namn till projektets stil, men behåll semantiken:

| Riktning | Typ | Innehåll | Syfte |
|---|---|---|---|
| remote → host | `hello` | `clientId`, `lastSeq` | Anslut, begär allt efter `lastSeq` |
| host → remote | `sync` | `fromSeq`, `events[]` | Ifyllnad efter `hello` eller omsynk |
| host → alla | `event` | `seq`, `event` | Nytt event tillagt i loggen |
| remote → host | `propose` | `proposalId`, `event` | Förslag: rättning, ångra, sätt in pil, starta om leg, byt spelare, … |
| host → remote | `reject` | `proposalId`, `reason` | Regelmotorn avvisade förslaget |
| remote → host | `resync` | `fromSeq` | Remote upptäckte lucka |
| host → remote | `frame` | `forSeq`, `jpegBase64`, `crop`, `tipPx` | Beskuren bild av träffområdet, se avsnitt 6 |
| båda | `ping` / `pong` | `t` | Livstecken, för att visa frånkopplad-status |

Regler:

- Host **validerar varje `propose` genom regelmotorn** exakt som om användaren
  tryckt på hosts egen skärm. Accepteras det: lägg till i loggen, tilldela `seq`,
  broadcasta `event` till alla remotes (även avsändaren). Avvisas det: `reject`.
- Remote tillämpar **aldrig** ett `propose` lokalt i förväg. Den väntar på
  `event`. Det gör remote trivialt konsistent på bekostnad av några tiotals
  millisekunders fördröjning, vilket är irrelevant här.
- `seq` är idempotensnyckeln. Ett `event` med ett `seq` remote redan har ignoreras.
- Meddelanden ska vara små. Håll `frame` utanför eventloggen (avsnitt 6).

---

## 5. Parkoppling via QR utan server

Det är den enda klumpiga delen, så gör den så bra som möjligt.

### Flöde

1. Användaren öppnar **"Anslut fjärrskärm"** på host. Det ska ligga **före
   kalibreringen** i uppstartsflödet (och vara nåbart från meny senare med en
   varning om att stativet kan behöva kontrolleras).
2. Host skapar `RTCPeerConnection`, en datakanal, ett erbjudande, väntar på
   komplett ICE-insamling, komprimerar SDP (nedan) och visar den som **QR-kod A**.
   Under QR-koden: samma sträng som text med **kopiera/dela-knapp**.
3. Remote öppnas på `?remote`. Den erbjuder **"Skanna QR"** (använd
   `BarcodeDetector` där det finns, annars ett litet bibliotek som `jsQR`) samt
   **"Klistra in kod"** som fallback för enheter utan kamera eller där
   skanning strular.
4. Remote sätter fjärrbeskrivningen, skapar svar, väntar på komplett ICE, komprimerar
   och visar **QR-kod B** samt texten med kopiera/dela-knapp.
5. Host går in i **läsläge**: samma kameraström som appen redan har, men letar
   QR istället för pilar (`BarcodeDetector` i Android Chrome; annars `jsQR` på
   den nedskalade bilden). Användaren håller upp remote framför kameran.
   Även här: **fallback med "Klistra in kod"** på host.
6. Kanalen öppnas. Remote skickar `hello`, host svarar `sync`. Host visar
   "fjärr ansluten". Användaren går vidare till kalibrering.

Flera remotes: upprepa flödet; host håller en `RTCPeerConnection` per remote.
Alla parkopplade remotes får föreslå event (det är sällskapsspel), men host
loggar `clientId` på varje accepterat förslag så att det syns i historiken.

### Komprimering av SDP

En komplett SDP med kandidater är typiskt 1–2 kB, vilket är tätt för en QR-kod
som ska skannas med mobilkamera. Gör i ordning:

1. `CompressionStream('deflate-raw')` → base64url. Finns i Chrome, Safari 16.4+
   och Firefox.
2. Om resultatet fortfarande överstiger ca 1 500 tecken: **minifiera SDP** före
   komprimering. Behåll bara det WebRTC behöver för en datakanal: `v=`, `o=`,
   `s=`, `t=`, `m=`, `c=`, `a=ice-ufrag`, `a=ice-pwd`, `a=fingerprint`,
   `a=setup`, `a=mid`, `a=sctp-port`, `a=max-message-size`, `a=candidate`,
   `a=end-of-candidates`. Skriv en test som verifierar att minifierad SDP
   fortfarande accepteras av `RTCPeerConnection.setRemoteDescription` (kan
   behöva köras i en webbläsarmiljö; om Vitest inte har WebRTC, gör det till ett
   manuellt testfall i `TESTPLAN.md` och testa minifiering/rundgång i Vitest).
3. Använd QR-felkorrigering **L** för att maximera kapaciteten.

Mät och dokumentera i `CLAUDE.md` hur långa strängarna faktiskt blev.

### Återanslutning

Korta nätglapp överlever datakanalen av sig själv. Går anslutningen helt förlorad
visar remote **"Frånkopplad — visar senast kända läge"** med tidsstämpel, och
behåller resultattavlan läsbar men låser rättningsknapparna. En ny anslutning
kräver ny parkoppling (utan server finns inget sätt att förhandla om ICE).
Säg det ärligt i UI:t. Host ska tåla att en remote försvinner utan att spelet
påverkas över huvud taget.

---

## 6. Bild per kast

Detta är det som gör fjärrättning användbar. Utan bild måste den som rättar gå
fram till tavlan och titta — och då är ingenting vunnet.

- När host registrerar ett pil-event, beskär **råbilden** (inte den warpade)
  runt spetsen — förslagsvis en kvadrat på ca 25 % av tavlans diameter i
  bildplanet, med spetsen någorlunda centrerad — och koda som JPEG med kvalitet
  ca 0,7 och en längsta sida på ca 320–400 px. Målet är **30–60 kB** per bild.
- Skicka som `frame` med `forSeq` = det pil-eventets sekvensnummer, `crop`
  (ursprung och storlek i råbildskoordinater) och `tipPx` (spetsens läge i den
  beskurna bilden), så att remote kan rita markören själv.
- **Lagra inte bilden i eventloggen.** Håll en separat ringbuffert på host
  (senaste ~30 kasten) och på remote. Bilder är diagnostik, inte speltillstånd.
- Om det redan finns ett steg i pipelinen där råbild och spetsposition finns
  tillsammans (det bör det, eftersom spetsen hittas i råbilden), häng på där.
  Bilden ska tas **efter** att detekteringen är klar, aldrig blockera den.
- På remote visas bilden i rättningsvyn tillsammans med en **renderad tavla**
  där appens tolkning är markerad. Användaren trycker på rätt segment i den
  renderade tavlan; det blir ett `propose`.

Bonus, om det blir enkelt: låt host spara `(beskuren bild, appens tolkning,
korrigerad tolkning)` för varje rättning i en lokal export (JSON + JPEG) som
går att hämta via USB-verktygen i `tools/`. Det är märkt träningsdata för
framtida förbättring av detekteringen. Ingen automatisk upplänk någonstans.

---

## 7. Remote-gränssnittet

Remote ska kunna användas på iPad, iPhone (Safari), Android-surfplatta, och
laptop. Krav:

- **Ingen kamerabegäran, ingen OpenCV.js, ingen detektering.** Kontrollera hur
  `opencv.js` laddas idag (script-tagg i `index.html`, dynamisk import, eller
  annat) och se till att `?remote` aldrig hämtar de ~10 MB. Om det kräver
  kodsplittning av kameradelen, gör det — men utan att förändra beteendet i
  enhetsläge.
- **Resultattavla läsbar från 2,4 m.** Aktuell spelare, poäng kvar (eller vad
  spelläget kräver — 301/501/Farfar har olika behov, läs regelmotorn), senaste
  tre pilarna med segment, tydlig markering av vem som står på tur. Stora
  typsnitt, hög kontrast, mörkt läge som standard.
- **Rättningsvy per pil**: bild från avsnitt 6, renderad tavla att trycka i,
  samma knappsats som host har idag som alternativ.
- **Turhistorik bakåt** med möjlighet att rätta äldre pilar och **sätta in
  missad pil** på rätt plats — samma operationer som host stöder, inga fler,
  inga färre. Om regelmotorn stöder det ska remote kunna göra det.
- **Legkontroller**: ångra senaste, starta om leg, byt spelare manuellt.
  Bekräftelsedialog på destruktiva val.
- **Wake Lock** (`navigator.wakeLock.request('screen')`) så att skärmen inte
  slocknar under matchen. Begär om igen vid `visibilitychange`.
- **Anslutningsstatus** alltid synlig men diskret.
- Tänk på att remote kan vara en telefon i porträttläge **eller** en surfplatta
  i landskapsläge. Layouten ska klara båda utan att bli en kompromiss.

Host ändras minimalt: parkopplingssteget, indikatorn, och att `frame`-bilderna
produceras. Inget nytt får läggas i vägen för det som finns.

---

## 8. Service worker (fas 0)

Appen har manifest och ikoner men cachas inte offline. Det är en förutsättning för
att fjärrskärmen ska kännas pålitlig i en lokal med dåligt wifi, och den är
oberoende av resten — gör den först och som separat commit.

- Använd `vite-plugin-pwa`. Precache **hela bygget inklusive `opencv.js`**.
  Strategin är cache-first: allt är statiskt, det finns inga API-anrop att hålla
  färska.
- **Base path.** Både service workerns scope och precache-URL:erna måste följa
  Vites `base` (`/kps-dart-cam/`). Verifiera i deployad version att den
  faktiskt registreras och cachar — detta är den vanligaste fällan med Pages.
- **Uppdateringar: fråga, ladda aldrig om automatiskt.** Visa en diskret rad
  "Ny version finns — ladda om?" och låt användaren välja tidpunkt. Appen
  återupptar redan sparade matcher, så en omladdning är överlevbar, men den ska
  inte ske oombedd mitt i en leg.
- **Visa byggversion** (git-hash eller byggtid, injicerad vid build) någonstans i
  UI:t, t.ex. i inställningar och i `?debug`-panelen. När något beter sig
  konstigt vid tavlan ska man kunna se vilken build som kör.
- Remote-läget ska också vara cachat, så att `?remote` laddar även när nätet
  svajar. Efter laddning behöver remote bara datakanalen.

---

## 9. Faser och leverans

Gör en commit per fas, tester gröna efter varje.

**Fas 0 — Service worker.** Enligt avsnitt 8. Kan slås ihop till `main`
separat, före resten, om den är stabil.

**Fas 1 — Synk-lager och protokoll utan UI.** `Transport`-gränssnitt,
`LoopbackTransport`, meddelandetyper, sekvensnummer, `matchId`, host-sidans
validering via regelmotorn, remote-sidans loggkopia och reducer. Tester:

- Rundgång av alla meddelandetyper.
- Host + remote via loopback konvergerar till identiskt tillstånd efter en
  serie kast och rättningar från båda sidor.
- Remote som återansluter med `lastSeq` får exakt de saknade eventen.
- Lucka i `seq` triggar `resync`.
- Dubblerat `event` ignoreras.
- Ogiltigt `propose` (t.ex. rättning av pil som inte finns) ger `reject` och
  lämnar loggen orörd.
- Nytt `matchId` får remote att tömma och synka om.
- Loopback med fördröjning och omkastad ordning ger ändå konvergens.

**Fas 2 — WebRTC och parkoppling.** `WebRtcTransport`, SDP-komprimering och
-minifiering (med rundgångstester), QR-generering och -läsning med fallbacks,
parkopplingsflödet på host och remote. Manuellt testfall i `TESTPLAN.md`.

**Fas 3 — Remote-gränssnittet.** Resultattavla, rättning, historik, legkontroller,
Wake Lock, anslutningsstatus. Kodsplittning så att remote inte laddar kamera/CV.

**Fas 4 — Bild per kast.** Beskärning, kodning, `frame`-meddelanden,
ringbuffertar, rättningsvyn med bild och renderad tavla. Valfritt:
träningsdata-export.

**Fas 5 — Dokumentation och avslut.** `AGENT.md`, `CLAUDE.md`, `README.md`
(ett avsnitt "Fjärrskärm" ur användarens perspektiv), `TESTPLAN.md` (fullständig
manuell genomgång: parkoppling, rättning från remote, två remotes samtidigt,
frånkoppling och återparkoppling, iPhone Safari som remote, laptop utan kamera
via klistra in, omladdning av remote mitt i leg, host oberörd när remote
försvinner).

---

## 10. Definition av klart

- `npm test` och `npm run lint` gröna. De befintliga 300 testerna orörda och gröna.
- En telefon i enhetsläge beter sig exakt som före ändringen, inklusive laddtid
  och minnesanvändning i rimlig mån.
- En iPad i Safari och en Android-surfplatta i Chrome kan båda parkopplas via
  QR utan att någon rör kameraenheten efter kalibreringen.
- En felavläsning rättas från remote; host säger upp det nya resultatet och
  fortsätter matchen; remote visar bilden av kastet under rättningen.
- Remote överlever omladdning mitt i en leg och visar rätt tillstånd inom någon
  sekund efter omanslutning.
- Deployad Pages-version registrerar service workern, startar utan nät efter
  första besöket, och visar byggversion.
- Ingen ny extern tjänst, ingen ny nätverksdestination, inga nycklar.

---

## 11. Öppna frågor — besvara i planen

Rekommenderad linje anges; motivera om du avviker.

1. **Hur exponeras sekvensnummer?** Rekommendation: tunt lager runt befintlig
   eventlogg utan att ändra eventens typer; om loggen redan har index, använd det.
2. **Var i pipelinen tas bilden till `frame`?** Rekommendation: direkt efter att
   ett pil-event skapats, från den råbild och spetsposition som detekteringen
   redan har, i en `requestIdleCallback`/mikrotask så att den aldrig försenar
   nästa analys.
3. **QR-läsning på host: `BarcodeDetector` eller OpenCV:s `QRCodeDetector`?**
   Rekommendation: `BarcodeDetector` först (host är Android Chrome), `jsQR` som
   fallback. Kontrollera om den självhostade `opencv.js`-builden alls innehåller
   `QRCodeDetector` innan du överväger den — anta inte.
4. **Ska remote få styra ljud och uppläsning?** Rekommendation: nej i första
   version; det stannar på host.
5. **Kodsplittning av kameradelen** — hur stor är ändringen och påverkar den
   laddflödet i enhetsläge? Rekommendation: lazy import av kamera/CV-modulen
   bakom en tydlig gräns, med samma laddindikator som idag.
6. **Vad händer om host laddas om mitt i match med remotes anslutna?** Datakanalen
   dör. Rekommendation: host visar tydligt att fjärrenheter behöver parkopplas
   om; remote går till frånkopplat läge. Dokumentera som känd begränsning.

---

## 12. Utanför uppdraget

- Åskådare eller spel över internet (kräver signaleringsserver — bryter mot
  avsnitt 1).
- Reläserver av något slag.
- Native-app, Capacitor-wrapper, iOS-app.
- Fler kameror.
- Alla ändringar i detektering, kalibrering och geometri.
- Turneringsläge, statistik, molnlagring.

Om du under arbetet ser något som *borde* göras men ligger här — skriv ner det i
`GRANSKNING.md` istället för att göra det.
