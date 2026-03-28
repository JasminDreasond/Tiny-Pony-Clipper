import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/** @type {string} */
const __filename = fileURLToPath(import.meta.url);
/** @type {string} */
const __dirname = dirname(__filename);

/** @type {import('express').Application} */
const app = express();
/** @type {number} */
const PORT = 4000;

app.use(express.static(join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`[TEST APP] Running at http://localhost:${PORT}`);
});
