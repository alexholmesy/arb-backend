const ODDS_BASE = "https://api.the-odds-api.com/v4";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.ODDS_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing ODDS_API_KEY" });
    }

    const regions = req.query.regions || "uk,eu,us";

    const url =
      `${ODDS_BASE}/sports/upcoming/odds/` +
      `?apiKey=${apiKey}` +
      `&regions=${regions}` +
      `&markets=h2h` +
      `&oddsFormat=decimal`;

    // simple timeout (safe for Vercel)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return res.status(502).json({
        error: "Odds API failed",
        status: response.status,
        details: text,
      });
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      return res.status(502).json({
        error: "Unexpected API format",
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "Request timed out" });
    }

    return res.status(500).json({
      error: "Server crash",
      message: err.message,
    });
  }
}
