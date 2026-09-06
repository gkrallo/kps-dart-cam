# KPs DartApp 🎯

Ett automatiskt poängräkningssystem för dart (501) som körs direkt i webbläsaren via mobilens kamera med hjälp av datorseende (OpenCV.js) och Google Gemini AI.

---

## 🌟 Funktioner

- **Realtidsdetektering av pilar**: Använder bildsubtraktion och konturanalys i OpenCV för att lokalisera när en pil kastas och träffar tavlan.
- **Interaktiv 4-punkts kalibrering**: Kalibrera enkelt genom att placera ut de fyra noderna (Topp 20, Höger 6, Botten 3, Vänster 11).
- **Auto-Kalibrering med AI & Datorseende**: Automatisk identifiering av tavlan via cirkeldetektering (HoughCircles) samt visuell analys med Google Gemini Vision.
- **Auto-Zoom & Zoom-reglage**: Zoomfunktion optimerad för mobilen som anpassar synfältet så att tavlan fyller skärmen med maximal precision.
- **Vision View vs Live View**: Växla smidigt mellan direkt videoström ("Live View") och den perspektivkorrigerade 2D-vyn ("Vision View") för att i detalj granska var datorseendet beräknar att pilarna har träffat.
- **Automatisk 501-spelläge**: Poängavräkning, historik över kastade pilar och automatisk omgångsväxling.

---

## 🔒 Säkerhet & Miljövariabler (Inför synkning till GitHub)

Projektet är konfigurerat enligt "Secure-by-Design":

1. **Inga hårkodade nycklar i koden**:
   - Inga API-nycklar, tokens eller lösenord finns i källkoden (`src/` eller `server.ts`).
2. **Server-Side API Proxy**:
   - Eventuella anrop mot Gemini API sker uteslutande via backend (`/api/analyze-board` i `server.ts`). API-nyckeln skickas aldrig till webbläsaren.
3. **`.gitignore` skyddar hemligheter**:
   - Alla lokala miljöfiler (`.env`, `.env.local`, `.env.production`) ignoreras automatiskt av Git och kommer **inte** att laddas upp till GitHub.
   - Endast `.env.example` (som innehåller ofarliga platshållare) checkas in.

---

## 🛠️ Teknikstack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, Motion.
- **Datorseende**: OpenCV.js (laddas asynkront och beräknar homografi, rörelse och pilspetsar lokalt i webbläsaren).
- **Backend / API Proxy**: Node.js & Express.
- **AI-modell**: `@google/genai` (Google Gemini 3.6 Flash) för smart bildanalys av tavlans orientering.

---

## 🚀 Kom igång lokalt

### Förutsättningar
- [Node.js](https://nodejs.org/) (version 18 eller senare)
- npm, yarn, pnpm eller bun

### Installation

1. **Klona repot**:
   ```bash
   git clone https://github.com/DITT-ANVÄNDARNAMN/kps-dartapp.git
   cd kps-dartapp
   ```

2. **Installera beroenden**:
   ```bash
   npm install
   ```

3. **Konfigurera miljövariabler**:
   Skapa en `.env`-fil baserad på mallen:
   ```bash
   cp .env.example .env
   ```
   Öppna `.env` och ange din Google Gemini API-nyckel om du vill använda AI-assisterad autokalibrering:
   ```env
   GEMINI_API_KEY=din_gemini_api_nyckel_här
   ```
   *(Obs: Appen och grundläggande manuell/lokal OpenCV-kalibrering fungerar även utan API-nyckel).*

4. **Starta utvecklingsservern**:
   ```bash
   npm run dev
   ```
   Appen startar på [http://localhost:3000](http://localhost:3000).

---

## 📱 Tips för bästa träffsäkerhet

1. **Belysning**: Se till att darttavlan är jämnt upplyst utan starka skuggor över siffrorna.
2. **Kameravinkel**: Rikta mobilkameran mot tavlans mitt. Även om homografin hanterar vinklar ger en relativt rak vinkel bäst precision.
3. **Auto-Zoom**: Använd zoomreglaget eller klicka på **Auto-Zoom** så att tavlan täcker större delen av skärmytan. Detta ger fler pixlar per dartsektor och märkbart bättre noggrannhet.
4. **Vision View**: Om en pil registreras felaktigt, slå över till **Vision View** för att se referensbilden och exakt var OpenCV placerade pilspetsens koordinater.

---

## 📜 Licens

Detta projekt är öppen källkod under MIT-licens.
