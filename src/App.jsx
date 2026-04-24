import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const TEST_MODE    = false;
const BACKEND_URL  = "https://arb-backend-nine.vercel.app/api/odds";
const AUTO_REFRESH_MS = 60_000;
const CLIENT_CACHE_TTL_MS = 60_000;
const DEBOUNCE_MS  = 2_000;

// Minimum arb % to show — filters noise from rounding errors
const MIN_PROFIT_PCT = 0.1;

// All UK bookmakers available in The Odds API
const UK_BOOKMAKERS = [
  "888sport",
  "Betfair Exchange",
  "Betfair Sportsbook",
  "Betfred",
  "Bet Victor",
  "Betway",
  "BoyleSports",
  "Casumo",
  "Coral",
  "Grosvenor",
  "Ladbrokes",
  "LeoVegas",
  "LiveScore Bet",
  "Matchbook",
  "Paddy Power",
  "Sky Bet",
  "Smarkets",
  "Unibet",
  "Virgin Bet",
  "William Hill",
];

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const MOCK_DATA = [
  {
    id: "mock1", sport_title: "Premier League", sport_key: "soccer_epl",
    home_team: "Arsenal", away_team: "Chelsea",
    commence_time: new Date(Date.now() + 45 * 60_000).toISOString(),
    bookmakers: [
      { title: "Bet365",       markets: [{ key: "h2h", outcomes: [{ name: "Arsenal", price: 2.20 }, { name: "Draw", price: 3.10 }, { name: "Chelsea", price: 3.80 }] }] },
      { title: "William Hill", markets: [{ key: "h2h", outcomes: [{ name: "Arsenal", price: 2.05 }, { name: "Draw", price: 3.20 }, { name: "Chelsea", price: 4.10 }] }] },
      { title: "Pinnacle",     markets: [{ key: "h2h", outcomes: [{ name: "Arsenal", price: 2.18 }, { name: "Draw", price: 3.30 }, { name: "Chelsea", price: 3.95 }] }] },
    ],
  },
  {
    id: "mock2", sport_title: "NBA", sport_key: "basketball_nba",
    home_team: "LA Lakers", away_team: "Boston Celtics",
    commence_time: new Date(Date.now() + 90 * 60_000).toISOString(),
    bookmakers: [
      { title: "DraftKings", markets: [{ key: "h2h", outcomes: [{ name: "LA Lakers", price: 2.10 }, { name: "Boston Celtics", price: 1.85 }] }] },
      { title: "FanDuel",    markets: [{ key: "h2h", outcomes: [{ name: "LA Lakers", price: 1.95 }, { name: "Boston Celtics", price: 1.95 }] }] },
      { title: "Pinnacle",   markets: [{ key: "h2h", outcomes: [{ name: "LA Lakers", price: 2.15 }, { name: "Boston Celtics", price: 1.80 }] }] },
    ],
  },
];

// ─── CLIENT-SIDE CACHE ────────────────────────────────────────────────────────
const clientCache = { data: null, ts: 0 };

// ─── FETCH ────────────────────────────────────────────────────────────────────
async function fetchOdds(signal) {
  if (clientCache.data && Date.now() - clientCache.ts < CLIENT_CACHE_TTL_MS) {
    return clientCache.data;
  }

  let res;
  try {
    res = await fetch(BACKEND_URL, { signal });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Cannot reach backend. Check your internet connection.");
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Backend returned invalid data (HTTP ${res.status})`);
  }

  if (!res.ok) {
    throw new Error(body?.error || `Backend error (HTTP ${res.status})`);
  }

  if (!Array.isArray(body)) {
    throw new Error(body?.error || "Unexpected response format from backend");
  }

  clientCache.data = body;
  clientCache.ts   = Date.now();
  return body;
}

// ─── TIME HELPERS ─────────────────────────────────────────────────────────────
function msToStart(commenceTime) {
  return new Date(commenceTime) - Date.now();
}

function getHeatLabel(commenceTime) {
  const hrs = msToStart(commenceTime) / 3_600_000;
  if (hrs <= 0)  return "live";
  if (hrs <= 2)  return "hot";
  if (hrs <= 6)  return "warm";
  return "cold";
}

function formatCountdown(commenceTime) {
  const ms = msToStart(commenceTime);
  if (ms <= 0) return "In play";
  const totalMins = Math.floor(ms / 60_000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" })
    + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ─── ARB MATHS ────────────────────────────────────────────────────────────────
function impliedProb(price) {
  if (!price || typeof price !== "number" || price <= 1) return 0;
  return 1 / price;
}

function findArbs(games, selectedBooks = null) {
  if (!Array.isArray(games)) return [];
  const arbs = [];

  for (const game of games) {
    // Guard: need at least 2 bookmakers with h2h markets
    if (!game || !Array.isArray(game.bookmakers) || game.bookmakers.length < 2) continue;

    // Build best-price map across all bookmakers
    const best = {};  // outcomeName -> { price, bookmaker }
    const bookSet = new Set();

    for (const bm of game.bookmakers) {
      if (!bm?.title) continue;
      // Skip bookmakers not in user's selected list
      if (selectedBooks && selectedBooks.size > 0 && !selectedBooks.has(bm.title)) continue;
      for (const mkt of (bm.markets || [])) {
        if (mkt?.key !== "h2h") continue;
        for (const o of (mkt.outcomes || [])) {
          if (!o?.name || typeof o.price !== "number" || o.price <= 1) continue;
          if (!best[o.name] || o.price > best[o.name].price) {
            best[o.name] = { price: o.price, bookmaker: bm.title };
          }
          bookSet.add(bm.title);
        }
      }
    }

    const outcomes = Object.entries(best);

    // Only support 2-way (tennis/NBA) and 3-way (football) markets
    if (outcomes.length < 2 || outcomes.length > 3) continue;

    // Arb check: sum of implied probs < 1
    const totalImplied = outcomes.reduce((sum, [, v]) => sum + impliedProb(v.price), 0);
    if (!isFinite(totalImplied) || totalImplied <= 0 || totalImplied >= 1) continue;

    const profitPct = ((1 / totalImplied) - 1) * 100;

    // Filter noise — require at least MIN_PROFIT_PCT
    if (!isFinite(profitPct) || profitPct < MIN_PROFIT_PCT) continue;

    // Auto-stake to produce at least £10 profit
    const autoStake = Math.max(10, Math.ceil(10 / (profitPct / 100)));
    const heat = getHeatLabel(game.commence_time);

    arbs.push({
      id:             game.id || Math.random().toString(36),
      sport:          game.sport_title || game.sport_key || "Unknown",
      homeTeam:       game.home_team   || "Home",
      awayTeam:       game.away_team   || "Away",
      commenceTime:   game.commence_time,
      outcomes,
      totalImplied,
      profitPct,
      autoStake,
      heat,
      bookmakerCount: bookSet.size,
    });
  }

  // Sort: live > hot > warm > cold, then by profit %
  const heatOrder = { live: 0, hot: 1, warm: 2, cold: 3 };
  return arbs.sort((a, b) => {
    const hd = (heatOrder[a.heat] ?? 3) - (heatOrder[b.heat] ?? 3);
    return hd !== 0 ? hd : b.profitPct - a.profitPct;
  });
}

function calcStakes(outcomes, stake, totalImplied) {
  if (!outcomes || !stake || !totalImplied) return [];
  return outcomes.map(([, v]) => {
    const s = (impliedProb(v.price) / totalImplied) * stake;
    return { stake: s, payout: s * v.price };
  });
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const COLS = ["#00e5a0", "#ff9f7b", "#b97bff"];

const HEAT_STYLE = {
  live: { bg: "rgba(255,50,50,0.15)",   border: "rgba(255,50,50,0.4)",   color: "#ff3232", label: "LIVE" },
  hot:  { bg: "rgba(255,80,80,0.12)",   border: "rgba(255,80,80,0.3)",   color: "#ff5050", label: "HOT" },
  warm: { bg: "rgba(255,160,0,0.10)",   border: "rgba(255,160,0,0.3)",   color: "#ffa000", label: "WARM" },
  cold: { bg: "rgba(100,100,120,0.08)", border: "rgba(100,100,120,0.2)", color: "#666",    label: "COLD" },
};

const btn = (active, activeColor) => ({
  padding: "8px 14px", borderRadius: "8px", border: "1px solid",
  borderColor: active ? `${activeColor}66` : "rgba(255,255,255,0.08)",
  background:  active ? `${activeColor}14` : "rgba(255,255,255,0.02)",
  color:       active ? activeColor        : "#555",
  fontFamily: "'Space Mono',monospace", fontSize: "11px", cursor: "pointer",
});

// ─── COMPONENTS ──────────────────────────────────────────────────────────────
function HeatBadge({ heat }) {
  const s = HEAT_STYLE[heat] || HEAT_STYLE.cold;
  return (
    <span style={{
      fontSize: "9px", fontWeight: "700", letterSpacing: "0.1em",
      padding: "2px 7px", borderRadius: "4px",
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
    }}>{s.label}</span>
  );
}

const ArbCard = memo(function ArbCard({ arb }) {
  const [expanded,    setExpanded]    = useState(false);
  const [customStake, setCustomStake] = useState(null);

  const stake  = customStake ?? arb.autoStake;
  const stakes = useMemo(
    () => calcStakes(arb.outcomes, stake, arb.totalImplied),
    [arb.outcomes, stake, arb.totalImplied]
  );
  const profit = stakes.length ? stakes[0].payout - stake : 0;

  const countdown = formatCountdown(arb.commenceTime);
  const time      = formatTime(arb.commenceTime);

  return (
    <div
      style={{
        background: "rgba(0,229,160,0.04)", border: "1px solid rgba(0,229,160,0.18)",
        borderRadius: "14px", padding: "18px 20px", marginBottom: "10px",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(0,229,160,0.4)"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(0,229,160,0.18)"}
    >
      {/* Summary row */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
            <span style={{ color: "#555", fontSize: "10px", letterSpacing: "0.08em" }}>{arb.sport.toUpperCase()}</span>
            <HeatBadge heat={arb.heat} />
          </div>
          <div style={{ color: "#fff", fontSize: "14px", fontWeight: "700", marginBottom: "4px" }}>
            {arb.homeTeam} <span style={{ color: "#444" }}>vs</span> {arb.awayTeam}
          </div>
          <div style={{ color: "#555", fontSize: "11px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: "#888" }}>{countdown}</span>
            <span style={{ color: "#2a2a3a" }}>·</span>
            <span>{time}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ color: "#00e5a0", fontSize: "22px", fontWeight: "700", lineHeight: 1 }}>+{arb.profitPct.toFixed(2)}%</div>
          <div style={{ color: "#00e5a0", fontSize: "13px", marginTop: "2px" }}>£{profit.toFixed(2)} profit</div>
          <div style={{ color: "#444", fontSize: "10px", marginTop: "2px" }}>on £{stake} · {arb.outcomes.length}-way</div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: "16px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "16px" }}>

          {/* Stake adjuster */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "10px 14px" }}>
            <span style={{ color: "#555", fontSize: "11px" }}>STAKE £</span>
            <input
              type="number" min="1" value={stake}
              onClick={e => e.stopPropagation()}
              onChange={e => {
                const v = parseFloat(e.target.value);
                setCustomStake(v > 0 ? v : arb.autoStake);
              }}
              style={{ background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.15)", color: "#fff", fontSize: "16px", fontFamily: "'Space Mono',monospace", fontWeight: "700", outline: "none", width: "100px" }}
            />
            <button
              onClick={e => { e.stopPropagation(); setCustomStake(null); }}
              style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", color: "#555", borderRadius: "6px", padding: "3px 8px", fontFamily: "'Space Mono',monospace", fontSize: "10px", cursor: "pointer" }}
            >RESET</button>
          </div>

          {/* Outcome rows */}
          {arb.outcomes.map(([name, v], i) => (
            <div key={name} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "10px", alignItems: "center", background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "10px 14px", marginBottom: "8px" }}>
              <div>
                <div style={{ color: COLS[i] || "#fff", fontSize: "12px", fontWeight: "700" }}>{name}</div>
                <div style={{ color: "#555", fontSize: "10px" }}>{v.bookmaker}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#555", fontSize: "9px" }}>ODDS</div>
                <div style={{ color: "#fff", fontSize: "13px" }}>{v.price.toFixed(2)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#555", fontSize: "9px" }}>STAKE</div>
                <div style={{ color: "#fff", fontSize: "13px" }}>£{(stakes[i]?.stake ?? 0).toFixed(2)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#555", fontSize: "9px" }}>RETURN</div>
                <div style={{ color: "#00e5a0", fontSize: "13px" }}>£{(stakes[i]?.payout ?? 0).toFixed(2)}</div>
              </div>
            </div>
          ))}

          {/* Profit summary */}
          <div style={{ background: "rgba(0,229,160,0.08)", border: "1px solid rgba(0,229,160,0.2)", borderRadius: "8px", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#888", fontSize: "11px", letterSpacing: "0.08em" }}>GUARANTEED PROFIT</span>
            <span style={{ color: "#00e5a0", fontSize: "18px", fontWeight: "700" }}>£{profit.toFixed(2)}</span>
          </div>

          <div style={{ color: "#2a2a3a", fontSize: "10px", marginTop: "8px" }}>
            {arb.bookmakerCount} bookmakers compared · total implied {(arb.totalImplied * 100).toFixed(2)}%
          </div>
        </div>
      )}
    </div>
  );
});

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function ArbScanLive() {
  const [rawGames,      setRawGames]      = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const [lastScanned,   setLastScanned]   = useState(null);
  const [scanned,       setScanned]       = useState(false);
  const [autoRefresh,   setAutoRefresh]   = useState(false);
  const [includeWarm,   setIncludeWarm]   = useState(true);
  const [scanStats,     setScanStats]     = useState(null);
  const [selectedBooks, setSelectedBooks] = useState(new Set(UK_BOOKMAKERS));
  const [showBookies,   setShowBookies]   = useState(false);

  const scanningRef      = useRef(false);
  const lastScanRef      = useRef(0);
  const abortRef         = useRef(null);
  const refreshTimerRef  = useRef(null);

  // ── Memoised arb calculation — only recalculates when games or filter changes
  const arbs = useMemo(() => {
    if (!rawGames.length) return [];
    const filtered = rawGames.filter(g => {
      const h = getHeatLabel(g.commence_time);
      return h === "live" || h === "hot" || (h === "warm" && includeWarm);
    });
    return findArbs(filtered, selectedBooks);
  }, [rawGames, includeWarm, selectedBooks]);

  // ── Scan ──────────────────────────────────────────────────────────────────
  const scan = useCallback(async (isAuto = false) => {
    if (scanningRef.current) return;

    // Debounce manual scans
    const now = Date.now();
    if (!isAuto && now - lastScanRef.current < DEBOUNCE_MS) return;
    lastScanRef.current = now;

    scanningRef.current = true;
    setLoading(true);
    setError(null);

    // Cancel previous in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    try {
      let games;

      if (TEST_MODE) {
        await new Promise(r => setTimeout(r, 600));
        games = MOCK_DATA;
      } else {
        games = await fetchOdds(signal);
      }

      // Guard against non-array
      if (!Array.isArray(games)) throw new Error("Invalid data received from backend");

      // Build stats from raw data (before heat filter)
      const allBooks = new Set();
      games.forEach(g => (g.bookmakers || []).forEach(bm => { if (bm?.title) allBooks.add(bm.title); }));
      setScanStats({ totalGames: games.length, bookmakers: allBooks.size });

      setRawGames(games);
      setLastScanned(new Date());
      setScanned(true);
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err.message || "Scan failed — please try again");
      }
    } finally {
      setLoading(false);
      scanningRef.current = false;
    }
  }, []); // no deps — rawGames filtering happens in useMemo

  const toggleBook = useCallback((name) => {
    setSelectedBooks(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        if (next.size <= 2) return prev; // need at least 2 to find arbs
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const selectAllBooks  = useCallback(() => setSelectedBooks(new Set(UK_BOOKMAKERS)), []);
  const clearAllBooks   = useCallback(() => setSelectedBooks(new Set(UK_BOOKMAKERS.slice(0, 2))), []);

  // ── Auto-refresh ──────────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(refreshTimerRef.current);
    if (!autoRefresh) return;
    refreshTimerRef.current = setInterval(() => {
      if (!document.hidden) scan(true);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(refreshTimerRef.current);
  }, [autoRefresh, scan]);

  // Trigger refresh when tab becomes visible
  useEffect(() => {
    const handler = () => {
      if (!document.hidden && autoRefresh && scanned) scan(true);
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [autoRefresh, scanned, scan]);

  // ── Render ────────────────────────────────────────────────────────────────
  const hotCount  = arbs.filter(a => a.heat === "hot" || a.heat === "live").length;
  const warmCount = arbs.filter(a => a.heat === "warm").length;

  return (
    <div style={{ minHeight: "100vh", background: "#080810", color: "#fff", fontFamily: "'Space Mono',monospace", padding: "24px 16px", maxWidth: "740px", margin: "0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);} }
        @keyframes pulse  { 0%,100%{opacity:1;}50%{opacity:0.3;} }
        @keyframes shimmer { 0%{width:15%;}50%{width:75%;}100%{width:15%;}  }
        .fade-up  { animation: fadeUp 0.3s ease forwards; }
        .shimmer  { animation: shimmer 1.5s ease-in-out infinite; }
        input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none;}
        input[type=number]{-moz-appearance:textfield;}
        button:active { opacity: 0.7; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
          <div style={{ width: "26px", height: "26px", borderRadius: "7px", background: "linear-gradient(135deg,#00e5a0,#00aaff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>◆</div>
          <h1 style={{ margin: 0, fontSize: "19px", fontWeight: "700", letterSpacing: "-0.02em" }}>
            ARB<span style={{ color: "#00e5a0" }}>SCAN</span>
            <span style={{ marginLeft: "8px", fontSize: "10px", fontWeight: "400", background: "rgba(0,229,160,0.12)", color: "#00e5a0", padding: "2px 7px", borderRadius: "4px" }}>
              {TEST_MODE ? "TEST" : "LIVE"}
            </span>
          </h1>
        </div>
        <p style={{ margin: 0, color: "#3a3a4a", fontSize: "10px", letterSpacing: "0.08em" }}>
          ALL SPORTS · UK EU US · {MIN_PROFIT_PCT}%+ ARBS ONLY
        </p>
      </div>

      {/* ── Controls ── */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
        <button style={btn(includeWarm, "#ffa000")} onClick={() => setIncludeWarm(v => !v)}>
          {includeWarm ? "▲ WARM ON" : "▲ WARM OFF"}
        </button>
        <button style={btn(autoRefresh, "#00aaff")} onClick={() => setAutoRefresh(v => !v)}>
          {autoRefresh ? "↺ AUTO ON" : "↺ AUTO OFF"}
        </button>
      </div>

      {/* ── Bookmaker picker ── */}
      <div style={{ marginBottom: "14px" }}>
        <button
          onClick={() => setShowBookies(v => !v)}
          style={{ ...btn(showBookies, "#00e5a0"), marginBottom: showBookies ? "10px" : "0" }}
        >
          {showBookies ? "▼ MY BOOKIES" : "▶ MY BOOKIES"} ({selectedBooks.size}/{UK_BOOKMAKERS.length})
        </button>

        {showBookies && (
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "14px" }}>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
              <button onClick={selectAllBooks} style={{ ...btn(false, "#00e5a0"), fontSize: "10px", padding: "5px 10px" }}>ALL</button>
              <button onClick={clearAllBooks}  style={{ ...btn(false, "#ff4d6d"), fontSize: "10px", padding: "5px 10px" }}>CLEAR</button>
              <span style={{ color: "#444", fontSize: "10px", alignSelf: "center" }}>tap to toggle — need at least 2</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {UK_BOOKMAKERS.map(name => {
                const active = selectedBooks.has(name);
                return (
                  <button
                    key={name}
                    onClick={() => toggleBook(name)}
                    style={{
                      padding: "5px 10px", borderRadius: "6px", border: "1px solid",
                      borderColor: active ? "rgba(0,229,160,0.4)" : "rgba(255,255,255,0.06)",
                      background:  active ? "rgba(0,229,160,0.09)" : "rgba(255,255,255,0.01)",
                      color:       active ? "#00e5a0" : "#444",
                      fontFamily: "'Space Mono',monospace", fontSize: "10px", cursor: "pointer",
                    }}
                  >{name}</button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Scan button ── */}
      <button
        onClick={() => scan(false)}
        disabled={loading}
        style={{
          width: "100%", padding: "13px", borderRadius: "11px",
          border: `1px solid ${loading ? "rgba(0,229,160,0.1)" : "rgba(0,229,160,0.35)"}`,
          background: loading ? "rgba(0,229,160,0.03)" : "rgba(0,229,160,0.09)",
          color: loading ? "#3a3a4a" : "#00e5a0",
          fontFamily: "'Space Mono',monospace", fontSize: "13px", fontWeight: "700",
          letterSpacing: "0.1em", cursor: loading ? "not-allowed" : "pointer",
          marginBottom: "18px", transition: "all 0.2s",
        }}
      >
        {loading ? "SCANNING..." : "⟳  SCAN FOR ARBS"}
      </button>

      {/* ── Loading bar ── */}
      {loading && (
        <div style={{ marginBottom: "20px" }}>
          <div style={{ color: "#3a3a4a", fontSize: "10px", marginBottom: "6px", letterSpacing: "0.06em" }}>
            FETCHING LIVE ODDS...
          </div>
          <div style={{ height: "2px", background: "rgba(255,255,255,0.04)", borderRadius: "2px", overflow: "hidden" }}>
            <div className="shimmer" style={{ height: "100%", background: "linear-gradient(90deg,#00e5a0,#00aaff)", borderRadius: "2px" }} />
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && !loading && (
        <div style={{ background: "rgba(255,77,109,0.06)", border: "1px solid rgba(255,77,109,0.2)", borderRadius: "12px", padding: "14px 18px", color: "#ff4d6d", fontSize: "11px", marginBottom: "16px", lineHeight: "1.6" }}>
          <div style={{ fontWeight: "700", marginBottom: "4px", fontSize: "12px" }}>SCAN FAILED</div>
          {error}
        </div>
      )}

      {/* ── Results ── */}
      {!loading && scanned && (
        <div className="fade-up">

          {/* Stats row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", flexWrap: "wrap", gap: "6px" }}>
            <span style={{ fontSize: "13px", fontWeight: "700", color: arbs.length > 0 ? "#00e5a0" : "#ff9f7b" }}>
              {arbs.length > 0 ? `${arbs.length} ARB${arbs.length !== 1 ? "S" : ""} FOUND` : "NO ARBS FOUND"}
            </span>
            {lastScanned && (
              <span style={{ color: "#333", fontSize: "10px" }}>
                {lastScanned.toLocaleTimeString("en-GB")}
              </span>
            )}
          </div>

          {scanStats && (
            <div style={{ color: "#333", fontSize: "10px", marginBottom: "14px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <span>{scanStats.totalGames} games scanned</span>
              <span>·</span>
              <span>{scanStats.bookmakers} bookmakers</span>
              {hotCount  > 0 && <span>· <span style={{ color: "#ff5050" }}>{hotCount} HOT</span></span>}
              {warmCount > 0 && <span>· <span style={{ color: "#ffa000" }}>{warmCount} WARM</span></span>}
            </div>
          )}

          {arbs.length === 0 && (
            <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: "12px", padding: "36px 20px", textAlign: "center", color: "#333", fontSize: "11px", lineHeight: "2" }}>
              No arb opportunities right now.<br />
              {!includeWarm && "Try turning WARM ON to see more events."}<br />
              Arbs appear most often close to kick-off.
            </div>
          )}

          {arbs.map(arb => <ArbCard key={arb.id} arb={arb} />)}
        </div>
      )}

      {/* ── Empty state ── */}
      {!scanned && !loading && !error && (
        <div style={{ textAlign: "center", padding: "56px 20px", color: "#252530", fontSize: "11px", lineHeight: "2.4" }}>
          <div style={{ fontSize: "36px", marginBottom: "14px", opacity: 0.2 }}>◆</div>
          Scans all upcoming sports for guaranteed profit opportunities.<br />
          <span style={{ color: "#ff5050" }}>HOT</span> = under 2h · <span style={{ color: "#ffa000" }}>WARM</span> = under 6h · <span style={{ color: "#444" }}>COLD</span> = later<br />
          Stakes are auto-calculated to guarantee at least £10 profit.
        </div>
      )}
    </div>
  );
}
