export const runtime = "nodejs";

const ODDS_BASE = "https://api.the-odds-api.com/v4";
const CACHE_TTL_MS = 60_000;

const cache = { data: null, ts: 0 };

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.ODDS_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Missing ODDS_API_KEY in Vercel environment variables"
      });
    }

    // cache
    if (cache.data && Date.now() - cache.ts < CACHE_TTL_MS) {
      return res.status(200).json(cache.data);
    }

    const regions = req.query.regions || "uk,eu,us";

    const url =
      `${ODDS_BASE}/sports/upcoming/odds/` +
      `?apiKey=${apiKey}&regions=${regions}&markets=h2h&oddsFormat=decimal`;

    const oddsRes = await fetch(url);

    if (!oddsRes.ok) {
      const text = await oddsRes.text();
      return res.status(500).json({
        error: "Odds API failed",
        status: oddsRes.status,
        details: text
      });
    }

    const data = await oddsRes.json();

    if (!Array.isArray(data)) {
      return res.status(500).json({
        error: "Unexpected response format",
        data
      });
    }

    cache.data = data;
    cache.ts = Date.now();

    return res.status(200).json(data);

  } catch (err) {
    console.error("SERVER ERROR:", err);
    return res.status(500).json({
      error: "Server crashed",
      message: err.message
    });
  }
}
