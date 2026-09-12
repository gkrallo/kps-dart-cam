# KPs DartCam 🎯

Automatisk poängräkning för dart via mobilens kamera. **Allt körs lokalt i
webbläsaren** — ingen server, ingen backend, inga API-nycklar, ingen löpande
kostnad. Kamerabilder lämnar aldrig telefonen.

---

## Status

Fungerar, men är inte färdigtrimmat. Geometrin och regelmotorn är verifierade
mot 284 tester; datorseendet är verifierat på riktig hårdvara i några
sessioner och har fortfarande kända hål.

**Fungerar:**

- Kalibrering: manuellt (fyra punkter med förstoringsglas), automatiskt
  (ellipsanpassning mot ringarnas färg) och ett sikte-steg som zoomar in
  tavlan åt dig.
- Sektorrotationen räknas ut ur tavlans egna färger — röd/grön-växlingen i
  dubbel- och trippelringen — så en tavla som hänger några grader snett inte
  förskjuter hela sektorhjulet.
- Detektering av landade pilar, spetsdetektering i råbilden, poäng enligt
  officiella WDF/BDO-mått.
- Spellägen 301, 501 och husspelet **Farfar**. Event-sourcad regelmotor: allt
  går att rätta i efterhand.
- Uppläsning på svenska (pil, poäng, spelarbyte, vinst) och ljudeffekter.
- Rättning: knappsats per pil, turhistorik bakåt, insättning av en missad pil
  på rätt plats i turen.
- Tavla tömd → automatiskt spelarbyte.

**Fungerar inte fullt ut:**

- Tre eller fler pilar som smälter ihop till en enda kontur ger bara en pil.
- Skuggor mitt i ett enfärgat fält kan inte avvisas (testet svarar "vet inte"
  och pilen behålls).
- En kamera ger några millimeters parallaxfel när pilen lutar mycket.
- Flera nyheter från september 2026 — avstämningen av pilar mot tavlan,
  avslöjandet av dolda pilar vid uttagning och den automatiska
  sektorrotationen — är verifierade offline men ännu inte mot riktiga kast.

`AGENT.md` har arkitekturen, `CLAUDE.md` har alla mätvärden och fallgropar.

---

## Kom igång

```bash
npm install
npm run dev
```

Öppna http://localhost:5173.

Vill du testa från telefonen på samma nät kör `npm run dev -- --host`. Tänk på
att **kameran kräver HTTPS** — webbläsare tillåter bara `getUserMedia` över
https:// eller på localhost. Använd `mkcert` för ett lokalt certifikat, eller
testa mot den publicerade Pages-versionen.

```bash
npm test          # 284 tester: geometri, kalibrering, spetsdetektering, regelmotor
npm run lint      # tsc --noEmit, strict mode
npm run build     # produktionsbygge till dist/
```

`npm run opencv` kopierar `opencv.js` från npm-paketet till `public/`. Det körs
automatiskt av `dev` och `build`, så du behöver sällan tänka på det.

Lägg till `?debug` i URL:en för en diagnostikpanel med detektorns tillstånd och
en rad per analys; `?debug&mask` ritar dessutom ut själva maskbilden.

---

## Publicering

Pushar du till `main` kör GitHub Actions testerna och deployar till GitHub
Pages. Aktivera det under **Settings → Pages → Source: GitHub Actions** — med
den gamla branch-baserade byggaren i gång tävlar de två och sidan blir vit.

Appen har manifest och ikoner och kan installeras på hemskärmen på både iPhone
och Android. Den cachas ännu inte offline.

---

## Så funkar det

1. **Kalibrering.** Fyra punkter på dubbelringens ytterkant vid sektor 20, 6, 3
   och 11. Ur dem beräknas en homografi som "plattar ut" tavlan till en
   800×800-bild rakt framifrån. Rotationen — vilken sektor som är 20 — kommer
   inte ur ringarna (de är rotationssymmetriska) utan ur röd/grön-växlingen
   längs dem.
2. **Detektering.** Varje bildruta jämförs med en referensbild. När något dykt
   upp och bilden stått still i 500 ms analyseras skillnaden. Pilens spets
   hittas i den **råa** bilden, inte den warpade: pilkroppen sticker ut ur
   tavlans plan och blir utsmetad av perspektivkorrigeringen.
3. **Avstämning.** Samtidigt diffas råbilden mot den tomma tavlan och alla
   pilformade blobbar stäms av mot de pilar appen redan registrerat. Blobb utan
   känd pil = nytt kast eller en dold pil som blottats; känd pil utan blobb =
   uttagen pil. Det är så appen vet skillnaden på ett kast och en uttagning.
4. **Poäng.** Spetsens position räknas om till millimeter från bullseye och
   jämförs med de officiella ringmåtten.

### Koordinatsystem

Detta är den viktigaste konventionen i hela kodbasen:

| | |
|---|---|
| Kanoniska koordinater | millimeter, bullseye i `(0, 0)`, Y växer nedåt |
| Dubbelringens ytterkant | 170 mm — det är hit kalibreringspunkterna sätts |
| Warpad bild | 800 × 800 px, alltså radie 400 px = 170 mm |
| Skala | 0,425 mm/px |
| Vinkel | 0° rakt upp (sektor 20), positivt medurs |

**Räkna aldrig poäng i pixlar.** Alla mått och trösklar bor i `BOARD_MM` i
`src/utils/dartMath.ts` och konverteras därifrån. Den ursprungliga versionen
hade hårdkodade pixelradier som var systematiskt fel — 6,4 mm av dubbelringens
8 mm klassades som MISS. Testerna i `dartMath.test.ts` vaktar mot att det
återuppstår.

---

## Tips för bästa träffsäkerhet

- **Stativ.** Telefonen måste stå still. Rörelsedetekteringen tolkar en
  handhållen kamera som ständig rörelse och registrerar då inga kast.
- **Belysningsring runt tavlan.** Den enskilt största förbättringen vi mätt:
  antalet konturer i masken föll från ~500 till 11, och bullträffar gick från
  13 mm fel till 2 mm. Mer värt än någon tröskeljustering.
- **Zooma in tavlan.** Använd sikte-steget. Vid 1× var tavlan bara ~365 px bred
  och pilarna låg precis på gränsen att sållas bort som för små blobbar.
- **Rak vinkel.** Homografin hanterar sneda vinklar, men ju rakare desto bättre.
- **Döm kalibreringen av de streckade sektorlinjerna mot tavlans riktiga
  trådar** — inte av wireframets form. Formen kan följa dubbelringen perfekt
  medan hela sektorhjulet är vridet. Knappen "Rikta in sektorer" rättar det.
- **Dra ut pilarna i omvänd ordning**, en i taget med en kort paus. Då kan
  appen upptäcka en pil som suttit dold bakom en annan och sätta in den på
  rätt plats i turen.
- **Kalibrera om** om telefonen flyttat sig, även lite.

---

## Testa utan darttavla

Nästan allt går att verifiera offline, och det är avsiktligt:

- `syntheticBoard.ts` renderar en geometriskt exakt tavla — och en pil som
  3D-kropp — genom en känd pinhole-kamera, med valfri linsdistorsion och seedat
  brus. Kalibrering, ellipsanpassning, spetsdetektering och hela poängkedjan
  testas alltså mot ett exakt facit.
- Fixturerna under `src/utils/__tests__/fixtures/` är riktiga foton av en
  riktig, sliten tavla. Testerna kör inte OpenCV, men matar geometrikedjan med
  faktiska pixeldata ur fotona: ringarnas färgmask, pilarnas maskblobbar, och
  4320 röd/grön-avläsningar längs ringarna.

---

## Teknik

- React 19, TypeScript (strict), Vite 6, Tailwind CSS v4
- OpenCV.js 4.12, självhostad och körd i webbläsaren via WASM
- Vitest
- Ingen backend, inga externa API-anrop, ingen telemetri

Homografin löses i ren TypeScript (DLT + Levenberg–Marquardt), inte via OpenCV:
den behövs i React-render för kalibreringens wireframe och i testerna, som kör
i Node utan WASM.

---

## Licens

MIT.
