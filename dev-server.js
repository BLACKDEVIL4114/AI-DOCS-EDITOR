import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Load environment variables manually if not using dotenv
import 'dotenv/config';

app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.url}`);
  next();
});

app.all('/:route', async (req, res) => {
  const { route } = req.params;
  const filePath = path.join(__dirname, 'api', `${route}.js`);

  if (fs.existsSync(filePath)) {
    try {
      const module = await import(`file://${filePath}?t=${Date.now()}`);
      const handler = module.default;
      await handler(req, res);
    } catch (err) {
      console.error(`Error in /api/${route}:`, err);
      res.status(500).json({ error: err.message });
    }
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`API Dev Server running on http://localhost:${PORT}`);
});
