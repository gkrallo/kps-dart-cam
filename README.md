# KPs DartCam 🎯

Automatisk poängräkning för dart via mobilens kamera. **Allt körs lokalt i
webbläsaren** — ingen server, ingen backend, inga API-nycklar, ingen löpande
kostnad.

---

## Status

Under ombyggnad. Grunden är städad och matematiken är verifierad, men
pilspetsdetekteringen och den automatiska kalibreringen är ännu inte klara.
Se [AGENT.md](./AGENT.md) för arkitektur och vad som återstår.

**Fungerar i dag:** manuell 4-punktskalibrering, perspektivkorrigering,
poängberäkning enligt officiella mått, 501-spelläge, uppläsning av poäng.

**Fungerar ännu inte bra:** automatisk detektering av tavlan (hittar ofta fel
cirkel, kan inte avgöra rotation) och pilspetsen (använder en förenklad metod
som plockar fel punkt när pilen ligger på tvären).

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
npm test          # 186 tester: geometri, kalibrering, regelmotor
npm run lint      # tsc --noEmit, strict mode
npm run build     # produktionsbygge till dist/
```

`npm run opencv` kopierar `opencv.js` från npm-paketet till `public/`. Det körs
automatiskt av `dev` och `build`, så du behöver sällan tänka på det.

---

## Publicering

Pushar du till `main` kör GitHub Actions testerna och deployar till GitHub
Pages. Aktivera det under **Settings → Pages → Source: GitHub Actions**.

Appen är en PWA och kan installeras på hemskärmen på både iPhone och Android.

---

## Så funkar det

1. **Kalibrering.** Du placerar fyra punkter på dubbelringens ytterkant vid
   sektor 20, 6, 3 och 11. Ur dem beräknas en homografi som "plattar ut" tavlan
   till en 800×800-bild rakt framifrån.
2. **Detektering.** Varje bildruta jämförs med en referensbild. När något
   dykt upp och bilden stått still i 500 ms analyseras skillnaden som en pil.
3. **Poäng.** Spetsens position räknas om till millimeter från bullseye och
   jämförs med de officiella ringmåtten.

### Koordinatsystem

Detta är den viktigaste konventionen i hela kodbasen:

| | |
|---|---|
| Kanoniska koordinater | millimeter, bullseye i `(0, 0)`, Y växer nedåt |
| Dubbelringens ytterkant | 170 mm — det är hit kalibreringspunkterna sätts |
| Warpad bild | 800 × 800 px, alltså radie 400 px = 170 mm |
| Skala | 0,425 mm/px |

**Räkna aldrig poäng i pixlar.** Alla mått och trösklar bor i `BOARD_MM` i
`src/utils/dartMath.ts` och konverteras därifrån. Den ursprungliga versionen
hade hårdkodade pixelradier som var systematiskt fel — 6,4 mm av dubbelringens
8 mm klassades som MISS. Testerna i `dartMath.test.ts` vaktar mot att det
återuppstår.

---

## Tips för bästa träffsäkerhet

- **Stativ.** Telefonen måste stå still. Rörelsedetekteringen tolkar en
  handhållen kamera som ständig rörelse och registrerar då inga kast.
- **Jämn belysning** utan hårda skuggor över tavlan.
- **Rak vinkel.** Homografin hanterar sneda vinklar, men ju rakare desto bättre.
- **Kalibrera om** om telefonen flyttat sig, även lite.

---

## Teknik

- React 19, TypeScript (strict), Vite, Tailwind CSS v4
- OpenCV.js 4.12, självhostad och körd i webbläsaren via WASM
- Vitest
- Ingen backend, inga externa API-anrop, ingen telemetri

Kamerabilder lämnar aldrig telefonen.

---

## Licens

MIT.
