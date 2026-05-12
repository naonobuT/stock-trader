const express = require('express');
const path = require('path');

const dbModule = require('./src/db');
const { getDb, initSymbolStats } = dbModule;
console.log('[server] Loaded db module:', Object.keys(dbModule));
const stockRoutes = require('./src/routes/stocks');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'trade.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/stocks', stockRoutes);
app.use('/api/admin', adminRoutes);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

(async () => {
  getDb();
  console.log('[server] DB initialized.');

  console.log('[server] Initializing symbol stats cache...');
  initSymbolStats();
  console.log('[server] Symbol stats cache ready.');

  app.listen(PORT, () => {
    console.log(`[server] Running at http://localhost:${PORT}`);
  });
})();
