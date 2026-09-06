# Arkitektur & Funktionskarta: KPs DartApp

## Översikt
KPs DartApp är ett automatiskt poängsystem för dart. Applikationen är en React SPA (Single Page Application) byggd med Vite och TypeScript, och designad med Tailwind CSS. All datorseende-logik (Computer Vision) körs 100% lokalt i användarens webbläsare med hjälp av OpenCV.js och mobilens kamera.

## Funktioner (Nuvarande iteration)
1. **Grundlayout**: Mörk, modern UI anpassad för mobilskärmar med en huvudsektion för kameravyn och en nedre panel för poäng och inställningar.
2. **Kameraintegration**: Använder enhetens bakre kamera (`facingMode: environment`) för att fånga videoströmmen.
3. **OpenCV.js Inladdning**: Laddar in OpenCV.js asynkront via ett CDN med hjälp av en custom hook (`useOpenCV`). Hanterar laddnings-state och visar en laddningsindikator.
4. **Interaktiv Kalibrering**: Ett SVG-överlägg låter användaren dra 4 noder (Topp, Höger, Botten, Vänster) för att markera darttavlans ytterkanter i videoströmmen.
5. **Perspektivtransformering (Homografi)**: OpenCV används för att räkna ut en transformationsmatris (homografi) baserat på de 4 noderna och en perfekt 800x800 kvadrat. Detta "plattar till" darttavlan matematiskt.
6. **Debug-vy för Kalibrering**: En liten rund canvas i bottenpanelen visar den transformerade darttavlan kontinuerligt.
7. **Detektion av Pilar (Background Subtraction)**: En kontinuerlig loop använder `cv.absdiff` för att jämföra nuvarande bild med en referensbild (baseline). Rörelse detekteras, och när bilden stabiliserats (ingen rörelse under 500ms) isoleras dartpilens form.
8. **Extraktion av Pilspets**: Koden använder `cv.findContours` på differensbilden för att hitta dartpilen och räknar sedan ut den punkt på konturen som ligger närmast tavlans centrum. Denna punkt markeras med grönt i debug-vyn.

## Filstruktur
- `/src/App.tsx`: Huvudkomponent, innehåller grundlayouten (Kameravy + Bottenpanel) och hanterar kalibreringslogiken.
- `/src/hooks/useOpenCV.ts`: Hook för asynkron laddning och initiering av OpenCV.
- `/src/hooks/useDartDetector.ts`: Hook som kontinuerligt kör homografitransformering, detekterar rörelse, utför bildsubtraktion och räknar ut pilspetsens position när bilden stabiliserats.
- `/src/components/CameraFeed.tsx`: Komponent som hanterar åtkomst till kamera, uppspelning av video och kan ta emot child-komponenter för överlägg.
- `/src/components/CalibrationOverlay.tsx`: SVG-baserat interaktivt överlägg för att dra och släppa kalibreringspunkterna.
- `/src/types.ts`: Innehåller globala typer (som `Point`).
- `/AGENT.md`: Denna fil, fungerar som levande dokumentation över projektets struktur och funktioner.

## Framtida funktionalitet (Kommande iterationer)
- Beräkning av faktiska dart-poäng utifrån pilarnas position på den *tillplattade* tavlan.
- Spel-logik (t.ex. 501, Cricket) och poänghistorik.
