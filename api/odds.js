// api/odds.js — Vercel serverless function (CommonJS)

const ODDS_BASE = “https://api.the-odds-api.com/v4”;
const CACHE_TTL_MS = 60_000;

const cache = { data: null, ts: 0 };

module.exports = async function handler(req, res) {
res.setHeader(“Access-Control-Allow-Origin”, “*”);
res.setHeader(“Access-Control-Allow-Methods”, “GET”);

if (req.method !== “GET”) {
return res.status(405).json({ error: “Method not allowed” });
}

const apiKey = process.env.ODDS_API_KEY;
if (!apiKey) {
return res.status(500).json({ error: “ODDS_API_KEY is not configured” });
}

if (cache.data && Date.now() - cache.ts < CACHE_TTL_MS) {
res.setHeader(“X-Cache”, “HIT”);
return res.status(200).json(cache.data);
}

const regions = (req.query && req.query.regions) || “uk,eu,us”;
const url = `${ODDS_BASE}/sports/upcoming/odds/?apiKey=${apiKey}&regions=${regions}&markets=h2h&oddsFormat=decimal`;

let oddsRes;
try {
oddsRes = await fetch(url);
} catch (err) {
return res.status(503).json({ error: “Cannot reach Odds API: “ + err.message });
}

if (!oddsRes.ok) {
let body = {};
try { body = await oddsRes.json(); } catch {}
const msg = body.message || `Odds API error ${oddsRes.status}`;
if (oddsRes.status === 401) return res.status(401).json({ error: “Invalid API key” });
if (oddsRes.status === 429) return res.status(429).json({ error: “API quota exceeded” });
return res.status(502).json({ error: msg });
}

let data;
try {
data = await oddsRes.json();
} catch {
return res.status(502).json({ error: “Invalid JSON from Odds API” });
}

if (!Array.isArray(data)) {
return res.status(502).json({ error: data?.message || “Unexpected response format” });
}

cache.data = data;
cache.ts = Date.now();

const remaining = oddsRes.headers.get(“x-requests-remaining”);
const used = oddsRes.headers.get(“x-requests-used”);
if (remaining) res.setHeader(“X-Requests-Remaining”, remaining);
if (used) res.setHeader(“X-Requests-Used”, used);
res.setHeader(“X-Cache”, “MISS”);

return res.status(200).json(data);
};
