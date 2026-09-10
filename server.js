import express from 'express';
import { registerRoutes } from './src/routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
registerRoutes(app);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Lar em Ordem em execução na porta ${port}`));
