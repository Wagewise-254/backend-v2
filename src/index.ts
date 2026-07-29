import http from 'node:http';

import app from './app.js';
import { logger } from './config/logger.js';

const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer(app);

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});