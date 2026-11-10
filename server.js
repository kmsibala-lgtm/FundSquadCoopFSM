const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------
// MongoDB Atlas connection (cached for Vercel serverless)
// ---------------------------------------------------------------
let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null };

async function connectDB() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');

  // Already connected and healthy: reuse it
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  // Never connected, or the connection dropped (common on serverless after idle): reconnect
  const rs = mongoose.connection.readyState;
  if (!cached.promise || rs === 0 || rs === 3) {
    cached.promise = mongoose
      .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 })
      .then((m) => {
        console.log('Connected to MongoDB Atlas');
        return m;
      });
  }
  try {
    await cached.promise;
  } catch (err) {
    cached.promise = null; // allow a retry on the next request
    throw err;
  }
  return mongoose.connection;
}

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Never cache API responses
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Make sure the DB is connected for every API request
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Database connection error:', err);
    res.status(500).json({ error: 'Database unavailable', detail: err.message });
  }
});

// Health check (open): visit /api/health, dbState 1 = connected
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    dbState: mongoose.connection.readyState,
    passcodeEnabled: !!process.env.APP_PASSCODE,
    time: new Date().toISOString()
  });
});

// Optional passcode: set APP_PASSCODE in Vercel env vars to lock the API.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

app.use('/api', (req, res, next) => {
  if (!process.env.APP_PASSCODE) return next();
  if (safeEqual(req.get('x-passcode') || '', process.env.APP_PASSCODE)) return next();
  res.status(401).json({ error: 'Passcode required' });
});

// ---------------------------------------------------------------
// Co-op state: one document holding all accounts + transactions
// ---------------------------------------------------------------
const CoOpStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'main' },
    // accounts are stored as [{ k: accountId, v: accountObject }] because
    // account IDs are user-editable and may contain characters Mongo dislikes
    accounts: { type: [mongoose.Schema.Types.Mixed], default: [] },
    transactions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    version: { type: Number, default: 0 }
  },
  { timestamps: true, minimize: false }
);

const CoOpState =
  mongoose.models.CoOpState || mongoose.model('CoOpState', CoOpStateSchema);

const toEntries = (obj) => Object.entries(obj).map(([k, v]) => ({ k, v }));
const fromEntries = (arr) =>
  (arr || []).reduce((o, e) => {
    o[e.k] = e.v;
    return o;
  }, {});

// Load everything
app.get('/api/state', wrap(async (req, res) => {
  const doc = await CoOpState.findOne({ key: 'main' }).lean();
  if (!doc) return res.json({ accounts: {}, transactions: [], version: 0 });
  res.json({
    accounts: fromEntries(doc.accounts),
    transactions: doc.transactions || [],
    version: doc.version
  });
}));

// Tiny check so other devices can see if anything changed without downloading everything
app.get('/api/state/version', wrap(async (req, res) => {
  const doc = await CoOpState.findOne({ key: 'main' }, { version: 1 }).lean();
  res.json({ version: doc ? doc.version : 0 });
}));

// Save everything (with a version check so devices can't silently overwrite each other)
app.put('/api/state', wrap(async (req, res) => {
  const { accounts, transactions, baseVersion } = req.body || {};

  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts) ||
      !Array.isArray(transactions)) {
    return res.status(400).json({ error: 'Expected { accounts: {}, transactions: [] }' });
  }

  const data = { accounts: toEntries(accounts), transactions };
  const base = Number(baseVersion) || 0;

  // First ever save
  if (base === 0) {
    try {
      await CoOpState.create({ key: 'main', ...data, version: 1 });
      return res.json({ version: 1 });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'Data already exists, reload first' });
      }
      throw err;
    }
  }

  // Normal save: only succeeds if nobody else saved since this client loaded
  const updated = await CoOpState.findOneAndUpdate(
    { key: 'main', version: base },
    { $set: data, $inc: { version: 1 } },
    { new: true }
  );
  if (!updated) {
    return res.status(409).json({ error: 'Data changed on another device, reload first' });
  }
  res.json({ version: updated.version });
}));

// ---------------------------------------------------------------
// Serve Frontend
// ---------------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error(`${req.method} ${req.originalUrl} failed:`, err);
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Server error', detail: err.message });
});

// Start locally (Vercel uses the exported app instead)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
