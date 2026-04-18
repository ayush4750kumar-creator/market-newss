const express = require('express');
const cors = require('cors');
const { initDB } = require('./services/database');
const { router: authRouter } = require('./routes/auth');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/pipeline2', require('./routes/pipeline2').router);

app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/', (req, res) => res.json({ success: true, message: 'Gramble API running' }));

initDB().then(() => {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}).catch(err => {
  console.error('[DB] Failed to initialize:', err.message);
  process.exit(1);
});
