// api/odds.js — Vercel serverless function
// Place this file at: /api/odds.js in your repo root.
// Set ODDS_API_KEY in Vercel project environment variables.

const ODDS_BASE = “https://api.the-odds-api.com/v4”;
const CACHE_TTL_MS = 60_000; // 60 seconds
const REGIONS = “uk,eu,us”;

// In-memory cache — survives across warm lambda invocations
let cache = { data: null, ts: 0 };

// Simple in-memory rate limiter — max 10 requests per minute per IP
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

function isRateLimited(ip) {
const now = Date.now();
const entry = rateLimitMap.get(ip) || { count: 0, ts: now };
if (now - entry.ts > RATE_LIMIT_WINDOW_MS) {
rateLimitMap.set(ip, { count: 1, ts: now });
return false;
}
if (entry.count >= RATE_LIMIT_MAX) return true;
rateLimitMap.set(ip, { count: entry.count + 1, ts: entry.ts });
return false;
}

module.exports = async function handler(req, res) {
// CORS — allow all origins (frontend is on a different domain)
res.setHeader(“Access-Control-Allow-Origin”, “*”);
res.setHeader(“Access-Control-Allow-Methods”, “GET, OPTIONS”);
res.setHeader(“Access-Control-Allow-Headers”, “Content-Type”);

if (req.method === “OPTIONS”) return res.status(200).end();
if (req.method !== “GET”) {
return res.status(405).json({ error: “Method not allowed” });
}

// Rate limiting
const ip = req.headers[“x-forwarded-for”]?.split(”,”)[0]?.trim() || “unknown”;
if (isRateLimited(ip)) {
return res.status(429).json({ error: “Too many requests — wait a moment and try again” });
}

// API key check
const apiKey = process.env.ODDS_API_KEY;
if (!apiKey) {
console.error(”[odds] ODDS_API_KEY environment variable is not set”);
return res.status(500).json({ error: “Server configuration error — API key missing” });
}

// Return cached response if still fresh
if (cache.data && Date.now() - cache.ts < CACHE_TTL_MS) {
res.setHeader(“X-Cache”, “HIT”);
res.setHeader(“X-Cache-Age”, String(Math.round((Date.now() - cache.ts) / 1000)) + “s”);
return res.status(200).json(cache.data);
}

// Fetch from Odds API
const regions = req.query?.regions || REGIONS;
const url = `${ODDS_BASE}/sports/upcoming/odds/?apiKey=${apiKey}&regions=${encodeURIComponent(regions)}&markets=h2h&oddsFormat=decimal`;

let oddsRes;
try {
oddsRes = await fetch(url, {
headers: { “Accept”: “application/json” },
});
} catch (err) {
console.error(”[odds] Network error reaching Odds API:”, err.message);
return res.status(503).json({ error: “Cannot reach Odds API — please try again shortly” });
}

// Handle Odds API error responses
if (!oddsRes.ok) {
let body = {};
try { body = await oddsRes.json(); } catch {}
const msg = body.message || `Odds API returned HTTP ${oddsRes.status}`;
console.error(`[odds] Odds API error ${oddsRes.status}:`, msg);

```
if (oddsRes.status === 401) return res.status(401).json({ error: "Invalid or expired API key" });
if (oddsRes.status === 422) return res.status(422).json({ error: "Invalid request parameters" });
if (oddsRes.status === 429) return res.status(429).json({ error: "Odds API quota exceeded — check your plan" });
return res.status(502).json({ error: msg });
```

}

// Parse response
let data;
try {
data = await oddsRes.json();
} catch (err) {
console.error(”[odds] Failed to parse Odds API JSON:”, err.message);
return res.status(502).json({ error: “Received invalid data from Odds API” });
}

// Validate it’s an array
if (!Array.isArray(data)) {
const msg = data?.message || data?.error || “Unexpected response format from Odds API”;
console.error(”[odds] Non-array response:”, data);
return res.status(502).json({ error: msg });
}

// Update cache
cache = { data, ts: Date.now() };

// Forward quota headers so frontend can display them
const remaining = oddsRes.headers.get(“x-requests-remaining”);
const used = oddsRes.headers.get(“x-requests-used”);
const cost = oddsRes.headers.get(“x-requests-last”);
if (remaining !== null) res.setHeader(“X-Requests-Remaining”, remaining);
if (used !== null) res.setHeader(“X-Requests-Used”, used);
if (cost !== null) res.setHeader(“X-Requests-Last”, cost);
res.setHeader(“X-Cache”, “MISS”);

return res.status(200).json(data);
};
