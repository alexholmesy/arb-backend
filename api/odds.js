 const ODDS_BASE = "https://api.the-odds-api.com/v4";

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") return res.status(200).end();

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

    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Server crash",
      message: err.message,
    });
  }
}
