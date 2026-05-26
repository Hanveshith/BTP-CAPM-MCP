const express = require('express');

const oauthRoutes = require('./src/auth/oauthRoutes');
const mcpRouter = require('./src/mcp/mcpRouter');
const { PORT } = require('./src/config/env');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(oauthRoutes);
app.use(mcpRouter);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});