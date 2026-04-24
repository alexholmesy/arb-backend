import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const TEST_MODE           = false;
const BACKEND_URL         = "https://arb-backend-nine.vercel.app/api/odds";
const AUTO_REFRESH_MS     = 60_000;
const CLIENT_CACHE_TTL_MS = 60_000;
const DEBOUNCE_MS         = 2_000;
const MIN_PROFIT_PCT      = 0.1;
const MIN_BOOKMAKERS      = 2;
const MAX_HOURS_AHEAD     = 6;

// ─── UK BOOKMAKERS ────────────────────────────────────────────────────────────
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

// ─── BOOKMAKER LINKS ──────────────────────────────────────────────────────────
const BOOKMAKER_URLS = {
  "888sport":           "https://www.888sport.com/",
  "Betfair Exchange":   "https://www.betfair.com/exchange/plus/",
  "Betfair Sportsbook": "https://www.betfair.com/",
  "Betfred":            "https://www.betfred.com/",
  "Bet Victor":         "https://www.betvictor.com/",
  "Betway":             "https://betway.com/en/sports",
  "BoyleSports":        "https://boylesports.com/sports/",
  "Casumo":             "https://www.casumo.com/en-gb/sports/",
  "Coral":              "https://sports.coral.co.uk/",
  "Grosvenor":          "https://www.grosvenorcasinos.com/sport",
  "Ladbrokes":          "https://www.ladbrokes.com/",
  "LeoVegas":           "https://www.leovegas.com/en-gb/",
  "LiveScore Bet":      "https://www.livescorebet.com/",
  "Matchbook":          "https://www.matchbook.com/",
  "Paddy Power":        "https://www.paddypower.com/",
  "Sky Bet":            "https://m.skybet.com/",
  "Smarkets":           "https://smarkets.com/",
  "Unibet":             "https://www.unibet.co.uk/",
  "Virgin Bet":         "https://www.virginbet.com/",
  "William Hill":       "https://sports.williamhill.com/",
  "Bet365":             "https://www.bet365.com/",
  "Pinnacle":           "https://www.pinnacle.com/",
};

function getBookmakerLink(name) {
  return BOOKMAKER_URLS[name] || "https://www.google.com/search?q=" + encodeURIComponent(name + " sports betting");
}

// Opens bookie on mobile — tries to open in new tab, falls back gracefully
function openBookmaker(name) {
  var url = getBookmakerLink(name);
  var win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    window.location.href = url;
  }
}

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
var MOCK_DATA = [
  {
    id: "mock1", sport_title: "Premier League", sport_key: "soccer_epl",
    home_team: "Arsenal", away_team: "Chelsea",
    commence_time: new Date(Date.now() + 45 * 60000).toISOString(),
    bookmakers: [
      { title: "Coral",        markets: [{ key: "h2h", outcomes: [{ name: "Arsenal", price: 2.20 }, { name: "Draw", price: 3.10 }, { name: "Chelsea", price: 3.80 }] }] },
      { title: "William Hill", markets: [{ key: "h2h", outcomes: [{ name: "Arsenal", price: 2.05 }, { name: "Draw", price: 3.20 }, { name: "Chelsea", price: 4.10 }] }] },
      { title: "Ladbrokes",    markets: [{ key: "h2h", outcomes: [{ name: "Arsenal", price: 2.18 }, { name: "Draw", price: 3.30 }, { name: "Chelsea", price: 3.95 }] }] },
    ],
  },
  {
    id: "mock2", sport_title: "La Liga", sport_key: "soccer_spain_la_liga",
    home_team: "Real Madrid", away_team: "Barcelona",
    commence_time: new Date(Date.now() + 90 * 60000).toISOString(),
    bookmakers: [
      { title: "Betfair Exchange", markets: [{ key: "h2h", outcomes: [{ name: "Real Madrid", price: 2.10 }, { name: "Draw", price: 3.40 }, { name: "Barcelona", price: 3.20 }] }] },
      { title: "Sky Bet",          markets: [{ key: "h2h", outcomes: [{ name: "Real Madrid", price: 1.95 }, { name: "Draw", price: 3.50 }, { name: "Barcelona", price: 3.40 }] }] },
      { title: "Paddy Power",      markets: [{ key: "h2h", outcomes: [{ name: "Real Madrid", price: 2.15 }, { name: "Draw", price: 3.30 }, { name: "Barcelona", price: 3.10 }] }] },
    ],
  },
];

// ─── CLIENT-SIDE CACHE ────────────────────────────────────────────────────────
var clientCache = { data: null, ts: 0 };

// ─── FETCH ────────────────────────────────────────────────────────────────────
async function fetchOdds(signal) {
  if (clientCache.data && Date.now() - clientCache.ts < CLIENT_CACHE_TTL_MS) {
    return clientCache.data;
  }
  var res;
  try {
    res = await fetch(BACKEND_URL, { signal });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Cannot reach backend. Check your internet connection.");
  }
  var body;
  try {
    body = await res.json();
  } catch (e) {
    throw new Error("Backend returned invalid data (HTTP " + res.status + ")");
  }
  if (!res.ok) {
    throw new Error((body && body.error) || "Backend error (HTTP " + res.status + ")");
  }
  if (!Array.isArray(body)) {
    throw new Error((body && body.error) || "Unexpected response format from backend");
  }
  clientCache.data = body;
  clientCache.ts   = Date.now();
  return body;
}

// ─── TIME HELPERS ─────────────────────────────────────────────────────────────
function msToStart(commenceTime) {
  return new Date(commenceTime).getTime() - Date.now();
}

function getHeatLabel(commenceTime) {
  var hrs = msToStart(commenceTime) / 3600000;
  if (hrs <= 0) return "live";
  if (hrs <= 2) return "hot";
  if (hrs <= 6) return "warm";
  return "cold";
}

function formatCountdown(commenceTime) {
  var ms = msToStart(commenceTime);
  if (ms <= 0) return "IN PLAY";
  var totalMins = Math.floor(ms / 60000);
  var h = Math.floor(totalMins / 60);
  var m = totalMins % 60;
  if (h > 0) return h + "h " + m + "m";
  return m + "m";
}

function formatTime(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" })
    + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ─── COPY TO CLIPBOARD ────────────────────────────────────────────────────────
function copyBetSlip(arb, stakes) {
  var lines = [];
  lines.push(arb.homeTeam + " vs " + arb.awayTeam);
  lines.push(arb.sport + " - " + formatTime(arb.commenceTime));
  lines.push("");
  for (var i = 0; i < arb.outcomes.length; i++) {
    var name = arb.outcomes[i][0];
    var v    = arb.outcomes[i][1];
    var s    = stakes[i];
    if (!s) continue;
    lines.push(v.bookmaker + " - " + name + " @ " + v.price.toFixed(2) + " - Stake £" + s.stake.toFixed(2));
  }
  lines.push("");
  lines.push("Guaranteed profit: £" + (stakes[0] ? (stakes[0].payout - stakes.reduce(function(t, s) { return t + s.stake; }, 0)).toFixed(2) : "0.00"));
  var text = lines.join("\n");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  var el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
  return Promise.resolve();
}

// ─── HIGH-PERFORMANCE findArbs ────────────────────────────────────────────────
// Uses plain for loops, no map/reduce, minimal allocations.
// Calculates implied probability in a single pass.
// Only builds outcome array when arb is confirmed valid.
function findArbs(games, selectedBooks) {
  if (!games || !games.length) return [];

  var arbs = [];
  var now  = Date.now();
  var maxMs = MAX_HOURS_AHEAD * 3600000;

  // Reusable objects to reduce GC pressure
  var bestPrice = {};
  var bestBook  = {};

  for (var gi = 0; gi < games.length; gi++) {
    var game = games[gi];
    if (!game) continue;

    // Skip games >6h away
    var gameMs = new Date(game.commence_time).getTime() - now;
    if (gameMs > maxMs) continue;

    var bookmakers = game.bookmakers;
    if (!bookmakers || bookmakers.length < MIN_BOOKMAKERS) continue;

    // Reset reusable maps
    var outcomeCount = 0;
    var outcomeName0 = null;
    var outcomeName1 = null;
    var outcomeName2 = null;
    var bookCount    = 0;

    // First pass: find best price per outcome
    for (var bi = 0; bi < bookmakers.length; bi++) {
      var bm = bookmakers[bi];
      if (!bm || !bm.title) continue;
      if (selectedBooks && !selectedBooks.has(bm.title)) continue;

      var markets = bm.markets;
      if (!markets) continue;

      for (var mi = 0; mi < markets.length; mi++) {
        var mkt = markets[mi];
        if (!mkt || mkt.key !== "h2h") continue;

        var outcomes = mkt.outcomes;
        if (!outcomes) continue;

        bookCount++;

        for (var oi = 0; oi < outcomes.length; oi++) {
          var o = outcomes[oi];
          if (!o || !o.name || typeof o.price !== "number" || o.price <= 1) continue;

          if (bestPrice[o.name] === undefined) {
            // New outcome name seen
            if (outcomeCount === 0) outcomeName0 = o.name;
            else if (outcomeCount === 1) outcomeName1 = o.name;
            else if (outcomeCount === 2) outcomeName2 = o.name;
            else continue; // >3 outcomes — skip
            outcomeCount++;
            bestPrice[o.name] = o.price;
            bestBook[o.name]  = bm.title;
          } else if (o.price > bestPrice[o.name]) {
            bestPrice[o.name] = o.price;
            bestBook[o.name]  = bm.title;
          }
        }
      }
    }

    // Need 2 or 3 outcomes
    if (outcomeCount < 2 || outcomeCount > 3) {
      // Clean up
      if (outcomeName0) { delete bestPrice[outcomeName0]; delete bestBook[outcomeName0]; }
      if (outcomeName1) { delete bestPrice[outcomeName1]; delete bestBook[outcomeName1]; }
      if (outcomeName2) { delete bestPrice[outcomeName2]; delete bestBook[outcomeName2]; }
      continue;
    }

    // Calculate total implied probability
    var p0 = bestPrice[outcomeName0] > 1 ? 1 / bestPrice[outcomeName0] : 0;
    var p1 = bestPrice[outcomeName1] > 1 ? 1 / bestPrice[outcomeName1] : 0;
    var p2 = outcomeCount === 3 && bestPrice[outcomeName2] > 1 ? 1 / bestPrice[outcomeName2] : 0;
    var totalImplied = p0 + p1 + p2;

    if (totalImplied <= 0 || totalImplied >= 1 || !isFinite(totalImplied)) {
      if (outcomeName0) { delete bestPrice[outcomeName0]; delete bestBook[outcomeName0]; }
      if (outcomeName1) { delete bestPrice[outcomeName1]; delete bestBook[outcomeName1]; }
      if (outcomeName2) { delete bestPrice[outcomeName2]; delete bestBook[outcomeName2]; }
      continue;
    }

    var profitPct = (1 / totalImplied - 1) * 100;
    if (profitPct < MIN_PROFIT_PCT || !isFinite(profitPct)) {
      if (outcomeName0) { delete bestPrice[outcomeName0]; delete bestBook[outcomeName0]; }
      if (outcomeName1) { delete bestPrice[outcomeName1]; delete bestBook[outcomeName1]; }
      if (outcomeName2) { delete bestPrice[outcomeName2]; delete bestBook[outcomeName2]; }
      continue;
    }

    // Valid arb — now build the outcome array (only allocated when needed)
    var arbOutcomes = [
      [outcomeName0, { price: bestPrice[outcomeName0], bookmaker: bestBook[outcomeName0] }],
      [outcomeName1, { price: bestPrice[outcomeName1], bookmaker: bestBook[outcomeName1] }],
    ];
    if (outcomeCount === 3) {
      arbOutcomes.push([outcomeName2, { price: bestPrice[outcomeName2], bookmaker: bestBook[outcomeName2] }]);
    }

    var autoStake = Math.max(10, Math.ceil(10 / (profitPct / 100)));
    var heat      = getHeatLabel(game.commence_time);

    arbs.push({
      id:             game.id || ("g" + gi),
      sport:          game.sport_title || game.sport_key || "Unknown",
      homeTeam:       game.home_team   || "Home",
      awayTeam:       game.away_team   || "Away",
      commenceTime:   game.commence_time,
      outcomes:       arbOutcomes,
      totalImplied:   totalImplied,
      profitPct:      profitPct,
      autoStake:      autoStake,
      heat:           heat,
      bookmakerCount: bookCount,
    });

    // Clean up reusable maps
    delete bestPrice[outcomeName0]; delete bestBook[outcomeName0];
    delete bestPrice[outcomeName1]; delete bestBook[outcomeName1];
    if (outcomeName2) { delete bestPrice[outcomeName2]; delete bestBook[outcomeName2]; }
  }

  // Sort: live > hot > warm > cold, then profit desc
  var heatOrder = { live: 0, hot: 1, warm: 2, cold: 3 };
  arbs.sort(function(a, b) {
    var hd = (heatOrder[a.heat] || 0) - (heatOrder[b.heat] || 0);
    return hd !== 0 ? hd : b.profitPct - a.profitPct;
  });
  return arbs;
}

function calcStakes(outcomes, stake, totalImplied) {
  if (!outcomes || !stake || !totalImplied) return [];
  var result = [];
  for (var i = 0; i < outcomes.length; i++) {
    var price = outcomes[i][1].price;
    var prob  = price > 1 ? 1 / price : 0;
    var s     = (prob / totalImplied) * stake;
    result.push({ stake: s, payout: s * price });
  }
  return result;
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
var COLS = ["#00e5a0", "#ff9f7b", "#b97bff"];

var HEAT_STYLE = {
  live: { bg: "rgba(255,50,50,0.15)",   border: "rgba(255,50,50,0.5)",   color: "#ff3232", label: "LIVE" },
  hot:  { bg: "rgba(255,100,50,0.12)",  border: "rgba(255,100,50,0.4)",  color: "#ff6432", label: "HOT" },
  warm: { bg: "rgba(255,160,0,0.10)",   border: "rgba(255,160,0,0.35)",  color: "#ffa000", label: "WARM" },
  cold: { bg: "rgba(100,100,120,0.06)", border: "rgba(100,100,120,0.15)", color: "#555",   label: "COLD" },
};

function profitColor(pct) {
  if (pct >= 2)   return "#00e5a0";
  if (pct >= 0.8) return "#ffe066";
  return "#aaffdd";
}

function btn(active, activeColor) {
  return {
    padding: "8px 14px", borderRadius: "8px", border: "1px solid",
    borderColor: active ? activeColor + "66" : "rgba(255,255,255,0.08)",
    background:  active ? activeColor + "14" : "rgba(255,255,255,0.02)",
    color:       active ? activeColor        : "#555",
    fontFamily: "'Space Mono',monospace", fontSize: "11px", cursor: "pointer",
    transition: "all 0.15s",
  };
}

// ─── COMPONENTS ──────────────────────────────────────────────────────────────
function HeatBadge({ heat }) {
  var s = HEAT_STYLE[heat] || HEAT_STYLE.cold;
  return (
    <span style={{
      fontSize: "9px", fontWeight: "700", letterSpacing: "0.1em",
      padding: "2px 7px", borderRadius: "4px",
      background: s.bg, border: "1px solid " + s.border, color: s.color,
      animation: heat === "live" ? "pulse 1.2s ease-in-out infinite" : "none",
    }}>{s.label}</span>
  );
}

// Sticky summary bar shown when there are results
function SummaryBar({ arbs, scanStats, lastScanned, loading, autoRefresh }) {
  if (!arbs) return null;
  var hotCount  = 0;
  var warmCount = 0;
  for (var i = 0; i < arbs.length; i++) {
    if (arbs[i].heat === "live" || arbs[i].heat === "hot") hotCount++;
    else if (arbs[i].heat === "warm") warmCount++;
  }
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 100,
      background: "rgba(8,8,16,0.95)",
      backdropFilter: "blur(8px)",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      padding: "10px 16px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      flexWrap: "wrap", gap: "8px",
      marginLeft: "-16px", marginRight: "-16px", marginBottom: "16px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <span style={{ fontWeight: "700", fontSize: "13px", color: arbs.length > 0 ? "#00e5a0" : "#ff9f7b" }}>
          {arbs.length} ARB{arbs.length !== 1 ? "S" : ""}
        </span>
        {hotCount > 0 && (
          <span style={{ fontSize: "10px", color: "#ff6432" }}>{hotCount} HOT</span>
        )}
        {warmCount > 0 && (
          <span style={{ fontSize: "10px", color: "#ffa000" }}>{warmCount} WARM</span>
        )}
        {scanStats && (
          <span style={{ fontSize: "10px", color: "#333" }}>
            {scanStats.totalGames} games · {scanStats.bookmakers} books
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {loading && (
          <span style={{ fontSize: "9px", color: "#00aaff", letterSpacing: "0.1em", animation: "pulse 1s infinite" }}>
            REFRESHING
          </span>
        )}
        {lastScanned && !loading && (
          <span style={{ fontSize: "10px", color: "#2a2a3a" }}>
            {lastScanned.toLocaleTimeString("en-GB")}
          </span>
        )}
        {autoRefresh && (
          <span style={{ fontSize: "9px", color: "#00aaff33", letterSpacing: "0.08em" }}>LIVE</span>
        )}
      </div>
    </div>
  );
}

var ArbCard = memo(function ArbCard({ arb }) {
  var [expanded,    setExpanded]    = useState(false);
  var [customStake, setCustomStake] = useState(null);
  var [copied,      setCopied]      = useState(false);

  var stake  = customStake !== null ? customStake : arb.autoStake;
  var stakes = useMemo(
    function() { return calcStakes(arb.outcomes, stake, arb.totalImplied); },
    [arb.outcomes, stake, arb.totalImplied]
  );

  var totalStaked = 0;
  for (var i = 0; i < stakes.length; i++) totalStaked += stakes[i] ? stakes[i].stake : 0;
  var profit = stakes.length ? stakes[0].payout - totalStaked : 0;

  var countdown   = formatCountdown(arb.commenceTime);
  var timeLabel   = formatTime(arb.commenceTime);
  var pColor      = profitColor(arb.profitPct);
  var heatStyle   = HEAT_STYLE[arb.heat] || HEAT_STYLE.cold;

  var cardBorder = arb.heat === "live" ? "rgba(255,50,50,0.4)"
                 : arb.heat === "hot"  ? "rgba(255,100,50,0.25)"
                 : "rgba(0,229,160,0.15)";

  function handleCopy(e) {
    e.stopPropagation();
    copyBetSlip(arb, stakes).then(function() {
      setCopied(true);
      setTimeout(function() { setCopied(false); }, 2000);
    });
  }

  return (
    <div style={{
      background: "rgba(255,255,255,0.025)",
      border: "1px solid " + cardBorder,
      borderRadius: "14px", padding: "16px 18px", marginBottom: "10px",
      transition: "border-color 0.15s, background 0.15s",
    }}
      onMouseEnter={function(e) { e.currentTarget.style.background = "rgba(255,255,255,0.035)"; }}
      onMouseLeave={function(e) { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}
    >
      {/* ── Summary row ── */}
      <div
        onClick={function() { setExpanded(function(v) { return !v; }); }}
        style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px" }}>
            <span style={{ color: "#444", fontSize: "9px", letterSpacing: "0.1em" }}>{arb.sport.toUpperCase()}</span>
            <HeatBadge heat={arb.heat} />
            <span style={{ color: "#2a2a3a", fontSize: "9px" }}>{arb.bookmakerCount} books</span>
          </div>
          <div style={{ color: "#fff", fontSize: "14px", fontWeight: "700", marginBottom: "5px", lineHeight: 1.2 }}>
            {arb.homeTeam} <span style={{ color: "#333" }}>vs</span> {arb.awayTeam}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "11px", fontWeight: "700", color: heatStyle.color }}>{countdown}</span>
            <span style={{ color: "#2a2a3a", fontSize: "10px" }}>·</span>
            <span style={{ color: "#444", fontSize: "10px" }}>{timeLabel}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ color: pColor, fontSize: "24px", fontWeight: "700", lineHeight: 1 }}>
            +{arb.profitPct.toFixed(2)}%
          </div>
          <div style={{ color: pColor, fontSize: "12px", marginTop: "3px", opacity: 0.9 }}>
            £{profit.toFixed(2)} profit
          </div>
          <div style={{ color: "#444", fontSize: "10px", marginTop: "2px" }}>
            stake £{stake} · {arb.outcomes.length}-way
          </div>
        </div>
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div style={{ marginTop: "14px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "14px" }}>

          {/* Stake adjuster */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "9px 12px" }}>
            <span style={{ color: "#444", fontSize: "11px" }}>STAKE £</span>
            <input
              type="number" min="1" value={stake}
              onClick={function(e) { e.stopPropagation(); }}
              onChange={function(e) {
                var v = parseFloat(e.target.value);
                setCustomStake(v > 0 ? v : arb.autoStake);
              }}
              style={{ background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: "15px", fontFamily: "'Space Mono',monospace", fontWeight: "700", outline: "none", width: "90px" }}
            />
            <button
              onClick={function(e) { e.stopPropagation(); setCustomStake(null); }}
              style={{ background: "none", border: "1px solid rgba(255,255,255,0.07)", color: "#444", borderRadius: "5px", padding: "3px 8px", fontFamily: "'Space Mono',monospace", fontSize: "10px", cursor: "pointer" }}
            >RESET</button>
          </div>

          {/* Outcome rows with OPEN BET button */}
          {arb.outcomes.map(function(outcome, i) {
            var name = outcome[0];
            var v    = outcome[1];
            var s    = stakes[i];
            return (
              <div key={name} style={{ background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "10px 12px", marginBottom: "7px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "10px", alignItems: "center", marginBottom: "8px" }}>
                  <div>
                    <div style={{ color: COLS[i] || "#fff", fontSize: "12px", fontWeight: "700" }}>{name}</div>
                    <div style={{ color: "#444", fontSize: "10px", marginTop: "2px" }}>{v.bookmaker}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#444", fontSize: "9px" }}>ODDS</div>
                    <div style={{ color: "#fff", fontSize: "13px", fontWeight: "700" }}>{v.price.toFixed(2)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#444", fontSize: "9px" }}>STAKE</div>
                    <div style={{ color: "#fff", fontSize: "13px" }}>£{(s ? s.stake : 0).toFixed(2)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#444", fontSize: "9px" }}>RETURN</div>
                    <div style={{ color: "#00e5a0", fontSize: "13px" }}>£{(s ? s.payout : 0).toFixed(2)}</div>
                  </div>
                </div>
                {/* OPEN BET button */}
                <button
                  onClick={function(e) { e.stopPropagation(); openBookmaker(v.bookmaker); }}
                  style={{
                    width: "100%", padding: "7px", borderRadius: "6px",
                    border: "1px solid rgba(0,229,160,0.25)",
                    background: "rgba(0,229,160,0.07)",
                    color: "#00e5a0", fontFamily: "'Space Mono',monospace",
                    fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em",
                    cursor: "pointer",
                  }}
                >
                  OPEN {v.bookmaker.toUpperCase()}
                </button>
              </div>
            );
          })}

          {/* Profit summary + copy slip */}
          <div style={{ background: "rgba(0,229,160,0.06)", border: "1px solid rgba(0,229,160,0.15)", borderRadius: "8px", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ color: "#666", fontSize: "11px", letterSpacing: "0.06em" }}>GUARANTEED PROFIT</span>
            <span style={{ color: "#00e5a0", fontSize: "18px", fontWeight: "700" }}>£{profit.toFixed(2)}</span>
          </div>

          <button
            onClick={handleCopy}
            style={{
              width: "100%", padding: "9px", borderRadius: "7px",
              border: "1px solid rgba(255,255,255,0.08)",
              background: copied ? "rgba(0,229,160,0.1)" : "rgba(255,255,255,0.03)",
              color: copied ? "#00e5a0" : "#555",
              fontFamily: "'Space Mono',monospace", fontSize: "11px",
              fontWeight: "700", letterSpacing: "0.08em", cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {copied ? "COPIED!" : "COPY BET SLIP"}
          </button>

          <div style={{ color: "#252530", fontSize: "10px", marginTop: "7px" }}>
            {arb.bookmakerCount} books compared · implied {(arb.totalImplied * 100).toFixed(2)}%
          </div>
        </div>
      )}
    </div>
  );
});

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function ArbScanLive() {
  var [rawGames,      setRawGames]      = useState([]);
  var [loading,       setLoading]       = useState(false);
  var [error,         setError]         = useState(null);
  var [lastScanned,   setLastScanned]   = useState(null);
  var [scanned,       setScanned]       = useState(false);
  var [autoRefresh,   setAutoRefresh]   = useState(false);
  var [includeWarm,   setIncludeWarm]   = useState(true);
  var [scanStats,     setScanStats]     = useState(null);
  var [selectedBooks, setSelectedBooks] = useState(function() { return new Set(UK_BOOKMAKERS); });
  var [showBookies,   setShowBookies]   = useState(false);

  var scanningRef     = useRef(false);
  var lastScanRef     = useRef(0);
  var abortRef        = useRef(null);
  var refreshTimerRef = useRef(null);

  // Memoised arb calculation
  var arbs = useMemo(function() {
    if (!rawGames.length) return [];
    var filtered = [];
    for (var i = 0; i < rawGames.length; i++) {
      var g = rawGames[i];
      var h = getHeatLabel(g.commence_time);
      if (h === "live" || h === "hot" || (h === "warm" && includeWarm)) {
        filtered.push(g);
      }
    }
    return findArbs(filtered, selectedBooks);
  }, [rawGames, includeWarm, selectedBooks]);

  // Scan
  var scan = useCallback(async function(isAuto) {
    if (scanningRef.current) return;
    var now = Date.now();
    if (!isAuto && now - lastScanRef.current < DEBOUNCE_MS) return;
    lastScanRef.current = now;
    scanningRef.current = true;
    setLoading(true);
    setError(null);
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    var signal = abortRef.current.signal;
    try {
      var games;
      if (TEST_MODE) {
        await new Promise(function(r) { setTimeout(r, 600); });
        games = MOCK_DATA;
      } else {
        games = await fetchOdds(signal);
      }
      if (!Array.isArray(games)) throw new Error("Invalid data received from backend");
      var allBooks = new Set();
      for (var i = 0; i < games.length; i++) {
        var bms = games[i].bookmakers || [];
        for (var j = 0; j < bms.length; j++) {
          if (bms[j] && bms[j].title) allBooks.add(bms[j].title);
        }
      }
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
  }, []);

  var toggleBook = useCallback(function(name) {
    setSelectedBooks(function(prev) {
      var next = new Set(prev);
      if (next.has(name)) {
        if (next.size <= 2) return prev;
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  var selectAllBooks = useCallback(function() { setSelectedBooks(new Set(UK_BOOKMAKERS)); }, []);
  var clearAllBooks  = useCallback(function() { setSelectedBooks(new Set([UK_BOOKMAKERS[0], UK_BOOKMAKERS[1]])); }, []);

  // Auto-refresh — pauses when tab is hidden
  useEffect(function() {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    if (!autoRefresh) return;
    refreshTimerRef.current = setInterval(function() {
      if (!document.hidden) scan(true);
    }, AUTO_REFRESH_MS);
    return function() { clearInterval(refreshTimerRef.current); };
  }, [autoRefresh, scan]);

  useEffect(function() {
    function handler() {
      if (!document.hidden && autoRefresh && scanned) scan(true);
    }
    document.addEventListener("visibilitychange", handler);
    return function() { document.removeEventListener("visibilitychange", handler); };
  }, [autoRefresh, scanned, scan]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#080810", color: "#fff", fontFamily: "'Space Mono',monospace", padding: "24px 16px", maxWidth: "740px", margin: "0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        @keyframes fadeUp   { from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);} }
        @keyframes pulse    { 0%,100%{opacity:1;}50%{opacity:0.3;} }
        @keyframes shimmer  { 0%{width:15%;}50%{width:75%;}100%{width:15%;} }
        .fade-up { animation: fadeUp 0.3s ease forwards; }
        .shimmer { animation: shimmer 1.5s ease-in-out infinite; }
        input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none;}
        input[type=number]{-moz-appearance:textfield;}
        button:active{opacity:0.7;}
      `}</style>

      {/* ── Header ── */}
      <div style={{ marginBottom: "18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
          <div style={{ width: "26px", height: "26px", borderRadius: "7px", background: "linear-gradient(135deg,#00e5a0,#00aaff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>◆</div>
          <h1 style={{ margin: 0, fontSize: "19px", fontWeight: "700", letterSpacing: "-0.02em" }}>
            ARB<span style={{ color: "#00e5a0" }}>SCAN</span>
            <span style={{ marginLeft: "8px", fontSize: "10px", fontWeight: "400", background: "rgba(0,229,160,0.12)", color: "#00e5a0", padding: "2px 7px", borderRadius: "4px" }}>
              {TEST_MODE ? "TEST" : "LIVE"}
            </span>
          </h1>
        </div>
        <p style={{ margin: 0, color: "#333", fontSize: "10px", letterSpacing: "0.08em" }}>
          ALL SPORTS · UK BOOKMAKERS · {MIN_PROFIT_PCT}%+ ARBS · WITHIN {MAX_HOURS_AHEAD}H
        </p>
      </div>

      {/* ── Controls ── */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        <button style={btn(includeWarm, "#ffa000")} onClick={function() { setIncludeWarm(function(v) { return !v; }); }}>
          {includeWarm ? "WARM ON" : "WARM OFF"}
        </button>
        <button style={btn(autoRefresh, "#00aaff")} onClick={function() { setAutoRefresh(function(v) { return !v; }); }}>
          {autoRefresh ? "AUTO ON" : "AUTO OFF"}
        </button>
      </div>

      {/* ── Bookmaker picker ── */}
      <div style={{ marginBottom: "12px" }}>
        <button
          onClick={function() { setShowBookies(function(v) { return !v; }); }}
          style={{ ...btn(showBookies, "#00e5a0"), marginBottom: showBookies ? "10px" : "0" }}
        >
          {showBookies ? "▼ MY BOOKIES" : "▶ MY BOOKIES"} ({selectedBooks.size}/{UK_BOOKMAKERS.length})
        </button>
        {showBookies && (
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "12px" }}>
            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              <button onClick={selectAllBooks} style={{ ...btn(false, "#00e5a0"), fontSize: "10px", padding: "5px 10px" }}>ALL</button>
              <button onClick={clearAllBooks}  style={{ ...btn(false, "#ff4d6d"), fontSize: "10px", padding: "5px 10px" }}>CLEAR</button>
              <span style={{ color: "#333", fontSize: "10px", alignSelf: "center" }}>min 2 required</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {UK_BOOKMAKERS.map(function(name) {
                var active = selectedBooks.has(name);
                return (
                  <button key={name} onClick={function() { toggleBook(name); }} style={{
                    padding: "5px 10px", borderRadius: "6px", border: "1px solid",
                    borderColor: active ? "rgba(0,229,160,0.4)" : "rgba(255,255,255,0.06)",
                    background:  active ? "rgba(0,229,160,0.09)" : "transparent",
                    color:       active ? "#00e5a0" : "#444",
                    fontFamily: "'Space Mono',monospace", fontSize: "10px", cursor: "pointer",
                  }}>{name}</button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Scan button ── */}
      <button
        onClick={function() { scan(false); }}
        disabled={loading}
        style={{
          width: "100%", padding: "13px", borderRadius: "11px",
          border: "1px solid " + (loading ? "rgba(0,229,160,0.1)" : "rgba(0,229,160,0.35)"),
          background: loading ? "rgba(0,229,160,0.03)" : "rgba(0,229,160,0.09)",
          color: loading ? "#3a3a4a" : "#00e5a0",
          fontFamily: "'Space Mono',monospace", fontSize: "13px", fontWeight: "700",
          letterSpacing: "0.1em", cursor: loading ? "not-allowed" : "pointer",
          marginBottom: "16px", transition: "all 0.2s",
        }}
      >
        {loading ? "SCANNING..." : "SCAN FOR ARBS"}
      </button>

      {/* ── Loading bar ── */}
      {loading && (
        <div style={{ marginBottom: "18px" }}>
          <div style={{ color: "#2a2a3a", fontSize: "10px", marginBottom: "6px", letterSpacing: "0.06em" }}>FETCHING LIVE ODDS...</div>
          <div style={{ height: "2px", background: "rgba(255,255,255,0.04)", borderRadius: "2px", overflow: "hidden" }}>
            <div className="shimmer" style={{ height: "100%", background: "linear-gradient(90deg,#00e5a0,#00aaff)", borderRadius: "2px" }} />
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && !loading && (
        <div style={{ background: "rgba(255,77,109,0.06)", border: "1px solid rgba(255,77,109,0.2)", borderRadius: "12px", padding: "14px 18px", color: "#ff4d6d", fontSize: "11px", marginBottom: "16px", lineHeight: "1.6" }}>
          <div style={{ fontWeight: "700", marginBottom: "4px" }}>SCAN FAILED</div>
          {error}
        </div>
      )}

      {/* ── Sticky summary bar (shown after first scan) ── */}
      {scanned && (
        <SummaryBar
          arbs={arbs}
          scanStats={scanStats}
          lastScanned={lastScanned}
          loading={loading}
          autoRefresh={autoRefresh}
        />
      )}

      {/* ── Results ── */}
      {!loading && scanned && (
        <div className="fade-up">
          {arbs.length === 0 && (
            <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: "12px", padding: "36px 20px", textAlign: "center", color: "#333", fontSize: "11px", lineHeight: "2" }}>
              No arb opportunities right now.<br />
              {!includeWarm && "Try turning WARM ON to see more events."}<br />
              Arbs appear most often 30–90 minutes before kick-off.
            </div>
          )}
          {arbs.map(function(arb) { return <ArbCard key={arb.id} arb={arb} />; })}
        </div>
      )}

      {/* ── Empty state ── */}
      {!scanned && !loading && !error && (
        <div style={{ textAlign: "center", padding: "56px 20px", color: "#1e1e28", fontSize: "11px", lineHeight: "2.4" }}>
          <div style={{ fontSize: "36px", marginBottom: "14px", opacity: 0.15 }}>◆</div>
          Scans all upcoming sports for guaranteed profit.<br />
          <span style={{ color: "#ff6432" }}>HOT</span> = under 2h · <span style={{ color: "#ffa000" }}>WARM</span> = under 6h<br />
          Stakes auto-calculated for minimum £10 profit.
        </div>
      )}
    </div>
  );
}
