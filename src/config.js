import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.dirname(here);
export const dataDir = process.env.DATA_DIR || path.join(projectRoot, 'data');
export const uploadsDir = path.join(dataDir, 'uploads');

fs.mkdirSync(uploadsDir, { recursive: true });
