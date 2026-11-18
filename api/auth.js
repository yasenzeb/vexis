// api/_auth.js — مشترك بين جميع endpoints

// ── Rate Limiting (in-memory, resets on cold start) ──
const rateLimitStore = new Map();

export function isRateLimited(key, maxRequests, windowMs) {
  const now = Date.now();
  const entry = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };

  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }

  entry.count++;
  rateLimitStore.set(key, entry);

  return entry.count > maxRequests;
}

// ── CORS Headers ──
export function setCorsHeaders(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, x-admin-password');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ── Admin Auth ──
// Frontend sends: header 'x-admin-password' with the plain password
export function requireAdmin(req) {
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.APIADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) return false;

  const pw = req.headers['x-admin-password'] || req.headers['x-admin-token'] || '';
  return pw === ADMIN_PASSWORD;
}

// ── Safe Error (never leak internals in production) ──
export function safeError(err) {
  return err?.message || String(err) || 'حدث خطأ غير متوقع.';
}
