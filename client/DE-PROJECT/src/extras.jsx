import { useEffect, useState } from "react";
import "./extras.css";

const COLORS = ["#c15f3c", "#3d7a5a", "#4a6fa5", "#8a5a9e", "#b08900", "#2a8c8c", "#a8456b", "#6b6b3a"];
const NAMES = ["A", "B", "C", "D"];

/* ---------- helpers ---------- */
const gray = (k) => Array.from({ length: 1 << k }, (_, i) => i ^ (i >> 1));
const bin = (v, k) => v.toString(2).padStart(k, "0");

// Same layout as the server's buildKmap, for the editor and quiz where no server result exists yet.
function makeMap(vars, values) {
  const rowBits = vars >> 1, colBits = vars - rowBits;
  const rg = gray(rowBits), cg = gray(colBits);
  return {
    rowVars: NAMES.slice(0, rowBits).join(""),
    colVars: NAMES.slice(rowBits, vars).join(""),
    rowLabels: rg.map((g) => bin(g, rowBits)),
    colLabels: cg.map((g) => bin(g, colBits)),
    grid: rg.map((r) => cg.map((c) => { const m = (r << colBits) | c; return { m, value: values[m] ?? 0 }; })),
  };
}

function Grid({ map, rings, hide, onCell }) {
  return (
    <table className="kmap">
      <thead>
        <tr>
          <th className="corner">{map.rowVars}\{map.colVars}</th>
          {map.colLabels.map((l) => <th key={l}>{l}</th>)}
        </tr>
      </thead>
      <tbody>
        {map.grid.map((row, r) => (
          <tr key={r}>
            <th>{map.rowLabels[r]}</th>
            {row.map((cell) => (
              <td
                key={cell.m}
                style={{ boxShadow: rings ? rings(cell.m) : undefined, cursor: onCell ? "pointer" : undefined }}
                className={hide ? "zero" : cell.value === 1 ? "one" : cell.value === "X" ? "dc" : "zero"}
                onClick={onCell ? () => onCell(cell.m) : undefined}
              >
                {hide ? "" : cell.value}
                <small>{cell.m}</small>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------- Step-by-step walkthrough ---------- */
export function Stepper({ result }) {
  const steps = result.steps;
  const [i, setI] = useState(0);
  const [play, setPlay] = useState(false);

  useEffect(() => { setI(0); setPlay(false); }, [result]);
  useEffect(() => {
    if (!play) return;
    if (i >= steps.length - 1) { setPlay(false); return; }
    const t = setTimeout(() => setI((x) => x + 1), 2600);
    return () => clearTimeout(t);
  }, [play, i, steps.length]);

  const s = steps[i];
  const order = result.cover.chosen;
  const rings = (m) =>
    s.groups
      .map((id) => ({ id, p: result.primes.find((p) => p.id === id) }))
      .filter((x) => x.p && x.p.minterms.includes(m))
      .map((x, n) => `inset 0 0 0 ${2 + n * 3}px ${COLORS[order.indexOf(x.id) % COLORS.length]}`)
      .join(", ");

  return (
    <div className="xt-card xt-stepper">
      <div className="xt-head">
        <h3>Step-by-step walkthrough</h3>
        <span className="muted small">Step {i + 1} of {steps.length}</span>
      </div>
      <Grid map={result.kmap} rings={rings} hide={s.show === "empty"} />
      <h4>{s.title}</h4>
      <p className="xt-text">{s.text}</p>
      <div className="xt-controls">
        <button className="btn" onClick={() => { setPlay(false); setI(Math.max(0, i - 1)); }} disabled={i === 0}>Back</button>
        <button className="btn" onClick={() => { setPlay(false); setI(Math.min(steps.length - 1, i + 1)); }} disabled={i === steps.length - 1}>Next</button>
        <button className="btn" onClick={() => { if (i >= steps.length - 1) setI(0); setPlay(!play); }}>{play ? "Pause" : "Play"}</button>
        <span className="xt-dots">
          {steps.map((_, n) => <i key={n} className={n === i ? "on" : ""} onClick={() => { setPlay(false); setI(n); }} />)}
        </span>
      </div>
    </div>
  );
}

/* ---------- Agent trace ---------- */
export function TracePanel({ trace, mode }) {
  if (!trace?.length) return null;
  return (
    <div className="xt-card">
      <div className="xt-head">
        <h3>Agent trace</h3>
        <span className="muted small">{mode === "agent" ? "LLM chose these tool calls" : "Same tools, run by the deterministic solver"}</span>
      </div>
      <ol className="xt-trace">
        {trace.map((t, n) => (
          <li key={n} className={t.ok ? "" : "bad"}>
            <code>{t.tool}</code>
            {t.input && <span className="muted small"> ({JSON.stringify(t.input)})</span>}
            <div className="small">{t.ok ? "✓" : "✗"} {t.summary}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- Logic circuit (AND-OR) ---------- */
export function Circuit({ circuit }) {
  const { names, terms } = circuit;
  if (!terms.length) return <p className="muted">F = 0, so there are no gates to draw.</p>;
  const nv = names.length, gw = 46;
  const busX = (v, neg) => 40 + names.indexOf(v) * 52 + (neg ? 22 : 0);
  const gx = 40 + nv * 52 + 30;
  let y = 56;
  const rows = terms.map((t) => {
    const k = t.literals.length, gh = Math.max(36, 16 * (k + 1));
    const row = { t, k, gh, top: y, yc: y + gh / 2 };
    y += gh + 26;
    return row;
  });
  const T = rows.length, H = y + 6;
  const orX = gx + gw + 56, orH = Math.max(56, T * 20);
  const orTop = (rows[0].yc + rows[T - 1].yc) / 2 - orH / 2;
  const W = (T === 1 ? gx + gw + 70 : orX + gw + 60);
  const lines = [], dots = [];
  const line = (pts, key) => lines.push(<polyline key={key} points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.4" />);

  rows.forEach((r, ti) => {
    const yIn = T === 1 ? r.yc : orTop + (orH * (ti + 1)) / (T + 1);
    const endX = T === 1 ? W - 30 : orX;
    r.t.literals.forEach((l, j) => {
      const wy = r.k === 1 ? r.yc : r.top + (r.gh * (j + 1)) / (r.k + 1);
      const bx = busX(l.v, l.neg);
      if (r.k === 1) line([[bx, wy], [gx + gw + 20, wy], [gx + gw + 20, yIn], [endX, yIn]], `w${ti}${j}`);
      else line([[bx, wy], [gx, wy]], `w${ti}${j}`);
      dots.push(<circle key={`d${ti}${j}`} cx={bx} cy={wy} r="3" fill="currentColor" />);
    });
    if (r.k >= 2) {
      line([[gx + gw, r.yc], [gx + gw + 20, r.yc], [gx + gw + 20, yIn], [endX, yIn]], `o${ti}`);
    } else if (r.k === 0) {
      line([[gx, r.yc], [endX, yIn]], `c${ti}`);
    }
  });

  return (
    <svg className="xt-circuit" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Logic circuit of the minimal expression">
      {names.map((v) => (
        <g key={v}>
          <text x={busX(v, false)} y="18" textAnchor="middle" fill="currentColor" fontSize="13">{v}</text>
          <text x={busX(v, true)} y="18" textAnchor="middle" fill="currentColor" fontSize="13">{v}′</text>
          <line x1={busX(v, false)} y1="26" x2={busX(v, false)} y2={H - 6} stroke="currentColor" strokeOpacity=".3" />
          <line x1={busX(v, true)} y1="26" x2={busX(v, true)} y2={H - 6} stroke="currentColor" strokeOpacity=".3" strokeDasharray="3 3" />
        </g>
      ))}
      {lines}
      {rows.filter((r) => r.k >= 2).map((r, n) => (
        <g key={`g${n}`}>
          <path d={`M${gx} ${r.top} H${gx + gw / 2} A${gw / 2} ${r.gh / 2} 0 0 1 ${gx + gw / 2} ${r.top + r.gh} H${gx} Z`} fill="var(--surface)" stroke="currentColor" strokeWidth="1.6" />
          <text x={gx + 14} y={r.yc + 4} textAnchor="middle" fill="currentColor" fontSize="11">AND</text>
        </g>
      ))}
      {rows.filter((r) => r.k === 0).map((r, n) => <text key={`k${n}`} x={gx} y={r.yc - 6} fill="currentColor" fontSize="13">1</text>)}
      {T > 1 && (
        <g>
          <path d={`M${orX} ${orTop} Q${orX + gw * 0.7} ${orTop} ${orX + gw} ${orTop + orH / 2} Q${orX + gw * 0.7} ${orTop + orH} ${orX} ${orTop + orH} Q${orX + gw * 0.3} ${orTop + orH / 2} ${orX} ${orTop} Z`} fill="var(--surface)" stroke="currentColor" strokeWidth="1.6" />
          <text x={orX + 20} y={orTop + orH / 2 + 4} textAnchor="middle" fill="currentColor" fontSize="11">OR</text>
          <line x1={orX + gw} y1={orTop + orH / 2} x2={W - 30} y2={orTop + orH / 2} stroke="currentColor" strokeWidth="1.4" />
        </g>
      )}
      <text x={W - 24} y={T > 1 ? orTop + orH / 2 + 5 : rows[0].yc + 5} fill="currentColor" fontSize="15" fontWeight="600">F</text>
      {dots}
    </svg>
  );
}

/* ---------- Everything under a solved result ---------- */
export function Extras({ out }) {
  const r = out?.result;
  if (!r || !r.steps) return null; // older saved chats have no extras
  return (
    <>
      <Stepper result={r} />

      <div className="xt-card">
        <div className="xt-head"><h3>Other forms</h3></div>
        <dl className="xt-forms">
          <dt>Minimal SOP</dt><dd>F = {r.cover.expression}</dd>
          <dt>Minimal POS</dt><dd>F = {r.pos.expression}</dd>
          <dt>NAND-only</dt><dd>F = {r.nand}</dd>
          <dt>NOR-only</dt><dd>F = {r.nor}</dd>
        </dl>
        <p className="muted small">POS comes from grouping the 0s. NAND-NAND and NOR-NOR are the SOP and POS forms rebuilt with a single gate type.</p>
      </div>

      <div className="xt-card">
        <div className="xt-head"><h3>Logic circuit (AND-OR)</h3></div>
        <Circuit circuit={r.circuit} />
      </div>

      <div className="xt-card">
        <div className="xt-head"><h3>Hazard check</h3></div>
        {r.hazards.length === 0 ? (
          <p>No static-1 hazards: every pair of neighbouring 1s is covered by a common group.</p>
        ) : (
          <>
            <p>Static-1 hazard possible: when only one input changes, the output could glitch to 0 for a moment.</p>
            <ul>
              {r.hazards.map((h, n) => (
                <li key={n}>
                  Cells {h.a} and {h.b} are neighbours but sit in different groups ({h.groups.join(", ")}).
                  {h.fixTerm && <> Fix: add the redundant term <b>{h.fixTerm}</b>.</>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <TracePanel trace={out.trace} mode={out.mode} />

      <p className="xt-print"><button className="btn" onClick={() => window.print()}>Export / print as PDF</button></p>
    </>
  );
}

/* ---------- K-map editor ---------- */
export function Editor({ api, token, onSolved }) {
  const [vars, setVars] = useState(3);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const cycle = (m) => setValues((v) => ({ ...v, [m]: !v[m] ? 1 : v[m] === 1 ? "X" : 0 }));
  const pick = (n) => { setVars(n); setValues({}); setError(""); };
  const ones = Object.keys(values).filter((m) => values[m] === 1).map(Number);
  const dcs = Object.keys(values).filter((m) => values[m] === "X").map(Number);

  async function solve() {
    setBusy(true); setError("");
    try {
      const res = await api("/kmap/solve-direct", { method: "POST", token, body: { vars, minterms: ones, dontCares: dcs } });
      onSolved(res);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <div className="stage"><div className="content">
      <h1 className="xt-title">K-map editor</h1>
      <p className="muted">Click a cell to cycle 0 → 1 → X (don't-care), then solve. This uses the deterministic solver directly.</p>
      <div className="xt-controls">
        {[2, 3, 4].map((n) => <button key={n} className={`btn ${vars === n ? "xt-on" : ""}`} onClick={() => pick(n)}>{n} variables</button>)}
      </div>
      <Grid map={makeMap(vars, values)} onCell={cycle} />
      <p className="muted small">Minterms: {ones.join(", ") || "none"}{dcs.length ? ` · don't-cares: ${dcs.join(", ")}` : ""}</p>
      {error && <p className="error">{error}</p>}
      <div className="xt-controls">
        <button className="btn xt-on" onClick={solve} disabled={busy || !ones.length}>{busy ? "Solving…" : "Solve this map"}</button>
        <button className="btn" onClick={() => setValues({})}>Clear</button>
      </div>
    </div></div>
  );
}

/* ---------- Practice quiz ---------- */
export function Quiz({ api, token }) {
  const [vars, setVars] = useState(3);
  const [p, setP] = useState(null);
  const [answer, setAnswer] = useState("");
  const [fb, setFb] = useState(null);
  const [score, setScore] = useState({ right: 0, tried: 0 });
  const [error, setError] = useState("");

  async function next(n = vars) {
    setError(""); setFb(null); setAnswer("");
    try { setP(await api(`/kmap/quiz?vars=${n}`, { token })); } catch (e) { setError(e.message); }
  }
  useEffect(() => { next(); }, []);

  async function check(giveUp) {
    setError("");
    try {
      const res = await api("/kmap/quiz/check", { method: "POST", token, body: { ...p, expression: answer, giveUp } });
      setFb(res);
      if (!giveUp) setScore((s) => ({ right: s.right + (res.correct ? 1 : 0), tried: s.tried + 1 }));
    } catch (e) { setError(e.message); }
  }

  const values = {};
  p?.minterms.forEach((m) => (values[m] = 1));
  p?.dontCares.forEach((m) => (values[m] = "X"));

  return (
    <div className="stage"><div className="content">
      <h1 className="xt-title">Practice quiz</h1>
      <p className="muted">Minimise the function, then type your answer in SOP form, e.g. <code>A'C + BD</code>. Score: {score.right}/{score.tried}</p>
      <div className="xt-controls">
        {[2, 3, 4].map((n) => <button key={n} className={`btn ${vars === n ? "xt-on" : ""}`} onClick={() => { setVars(n); next(n); }}>{n} variables</button>)}
      </div>
      {p && (
        <>
          <p className="result">F = Σm({p.minterms.join(", ")}){p.dontCares.length ? ` + d(${p.dontCares.join(", ")})` : ""}</p>
          <Grid map={makeMap(p.vars, values)} />
          <form onSubmit={(e) => { e.preventDefault(); if (answer.trim()) check(false); }} className="xt-answer">
            <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your minimal expression, e.g. A'B + C" aria-label="Your answer" />
            <button type="submit" className="btn xt-on" disabled={!answer.trim()}>Check</button>
          </form>
          {error && <p className="error">{error}</p>}
          {fb?.feedback && <p className={fb.correct ? "xt-ok" : "error"}>{fb.feedback}</p>}
          <div className="xt-controls">
            <button className="btn" onClick={() => check(true)}>Show solution</button>
            <button className="btn" onClick={() => next()}>New problem</button>
          </div>
          {fb?.solution && (
            <>
              <p className="result">F = {fb.solution.result.cover.expression}</p>
              <Stepper result={fb.solution.result} />
            </>
          )}
        </>
      )}
    </div></div>
  );
}
