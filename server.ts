import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // AI Vision endpoint to analyze dartboard snapshot and detect ring landmarks
  app.post('/api/analyze-board', async (req, res) => {
    try {
      const { imageBase64 } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: 'Missing imageBase64' });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
      }

      const ai = new GoogleGenAI({ apiKey });

      // Strip data URL header if present
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

      const prompt = `You are a precision computer vision system for automated dartboard calibration.
FIRST, carefully inspect the entire image:
- Is an actual, physical circular DARTBOARD (with red/green double & triple scoring rings, black/white or black/red pie segments, spider wires, and sector numbers 1 to 20) clearly visible in this image frame?

IF NO DARTBOARD IS PRESENT (e.g. the image shows a person, face, room, wall, clothes, bath towel, furniture, or generic background without a real dartboard):
Return strictly JSON:
{
  "isDartboardPresent": false,
  "confidence": 0.0,
  "reason": "No dartboard found in frame"
}

IF A REAL DARTBOARD IS VISIBLE in the image frame:
Identify 5 precise key landmarks on the dartboard:
1. "bullseye": Exact center of the red Bullseye dot (50 pts) in the middle.
2. "top20": Center of the outer DOUBLE 20 segment wire (Top / 12 o'clock position).
3. "right6": Center of the outer DOUBLE 6 segment wire (Right / 3 o'clock position).
4. "bottom3": Center of the outer DOUBLE 3 segment wire (Bottom / 6 o'clock position).
5. "left11": Center of the outer DOUBLE 11 segment wire (Left / 9 o'clock position).

CRITICAL LANDMARK RULES:
- The 4 double ring points MUST be on the thin outermost red/green double ring segments of the dartboard.
- Do NOT pick the outer black rubber surround, wood cabinet, walls, or clothing!
- Return normalized coordinates between 0.000 and 1.000.

Return strictly JSON:
{
  "isDartboardPresent": true,
  "confidence": 0.95,
  "landmarks": {
    "bullseye": {"x": 0.50, "y": 0.50},
    "top20": {"x": 0.50, "y": 0.28},
    "right6": {"x": 0.72, "y": 0.50},
    "bottom3": {"x": 0.50, "y": 0.72},
    "left11": {"x": 0.28, "y": 0.50}
  }
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64Data,
                },
              },
            ],
          },
        ],
      });

      const text = response.text || '';
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      res.json({
        success: true,
        isDartboardPresent: parsed.isDartboardPresent !== false,
        landmarks: parsed.landmarks || (parsed.top20 ? parsed : null)
      });
    } catch (err: any) {
      console.error('Error analyzing board with Gemini:', err);
      res.status(500).json({ error: err.message || 'Failed to analyze board' });
    }
  });

  // Vite middleware for development vs static serve for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
