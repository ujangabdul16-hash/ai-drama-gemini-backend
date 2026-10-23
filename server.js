import express from 'express';
import rateLimit from 'express-rate-limit';

const app = express();
const PORT = process.env.PORT || 10000;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
// Needed because the HTML may be opened as a local file (origin: null).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-password');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
const limiter = rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Terlalu banyak permintaan. Tunggu satu menit lalu coba lagi.' } });
app.use('/api/', limiter);
function authorized(req, res, next) {
  const expected = process.env.APP_ACCESS_PASSWORD;
  if (!expected) return res.status(503).json({ error: 'APP_ACCESS_PASSWORD belum diatur di environment server.' });
  if ((req.get('x-app-password') || '') !== expected) return res.status(401).json({ error: 'Kode akses salah. Periksa APP_ACCESS_PASSWORD di Render.' });
  next();
}
app.get('/api/health', authorized, (req, res) => {
  res.json({ ok: true, configured: Boolean(process.env.GEMINI_API_KEY), model: MODEL });
});
app.post('/api/generate', authorized, async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'GEMINI_API_KEY belum diatur di Render.' });
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) return res.status(400).json({ error: 'Prompt tidak boleh kosong.' });
    if (prompt.length > 30000) return res.status(413).json({ error: 'Prompt terlalu panjang (maksimal 30.000 karakter).' });
    const payload = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 8192 } };
    if (req.body?.json) payload.generationConfig.responseMimeType = 'application/json';
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(90000)
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const detail = data?.error?.message || 'Gemini API mengembalikan kesalahan.';
      const status = upstream.status === 429 ? 429 : 502;
      return res.status(status).json({ error: detail.slice(0, 500) });
    }
    const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!text) return res.status(502).json({ error: 'Gemini tidak mengembalikan teks. Coba ulangi dengan instruksi yang lebih singkat.' });
    res.json({ text, model: MODEL });
  } catch (err) {
    const message = err?.name === 'TimeoutError' ? 'Permintaan Gemini terlalu lama. Coba lagi.' : 'Terjadi kesalahan pada backend saat menghubungi Gemini.';
    res.status(500).json({ error: message });
  }
});
app.get('/', (req, res) => res.type('text').send('AI DRAMA TOOLS Gemini backend is running. Check /api/health with your access code.'));
app.listen(PORT, '0.0.0.0', () => console.log(`AI DRAMA TOOLS backend listening on ${PORT}`));
