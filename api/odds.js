const ODDS_BASE = “https://api.the-odds-api.com/v4”;
const CACHE_TTL_MS = 60_000;

let cache = { data: null, ts: 0 };

export default async function handler(req, res) {
try {
res.setHeader(“Access-Control-Allow-Origin”, “*”);
res.setHeader(“Access-Control-Allow-Methods”, “GET, OPTIONS”);
if (req.method === “OPTIONS”) return res.status(200).end();

```
if (req.method !== "GET") {
  return res.status(405).json({ error: "Method not allowed" });
}

const apiKey = process.env.ODDS_API_KEY;
if (!apiKey) {
  return res.status(500).json({ error: "Missing ODDS_API_KEY" });
}

// Return cached data if fresh
if (cache.data && Date.now() - cache.ts < CACHE_TTL_MS) {
  res.setHeader("X-Cache", "HIT");
  return res.status(200).json(cache.data);
}

const regions = req.query.regions || "uk,eu,us";
const url =
  `${ODDS_BASE}/sports/upcoming/odds/` +
  `?apiKey=${apiKey}&regions=${regions}&markets=h2h&oddsFormat=decimal`;

const response = await fetch(url);

if (!response.ok) {
  const text = await response.text();
  return res.status(500).json({
    error: "Odds API failed",
    status: response.status,
    details: text,
  });
}

const data = await response.json();

cache = { data, ts: Date.now() };
res.setHeader("X-Cache", "MISS");

return res.status(200).json(data);
```

} catch (err) {
console.error(err);
return res.status(500).json({
error: “Server crash”,
message: err.message,
});
