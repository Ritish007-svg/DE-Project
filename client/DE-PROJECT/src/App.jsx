import { useEffect, useRef, useState } from "react";
import "./layout.css";
import { Extras, Editor, Quiz } from "./extras.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";
const COLORS = ["#c15f3c", "#3d7a5a", "#4a6fa5", "#8a5a9e", "#b08900", "#2a8c8c", "#a8456b", "#6b6b3a"];
const isMobile = () => window.innerWidth <= 768;

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { status: res.status });
  return data;
}

/* ---------- Theme ---------- */
function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return [theme, toggle];
}

function ThemeToggle({ theme, onToggle }) {
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="icon theme"
      onClick={onToggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

/* ---------- Auth ---------- */
function Auth({ onAuth, theme, onToggleTheme }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      const d = await api(`/auth/${mode}`, { method: "POST", body: { email, password } });
      onAuth(d.token, d.email);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    // a div (not <main>) so global `main { max-width ... }` rules can't squeeze it
    <div className="auth">
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      <div className="auth-card">
        <h1>K-map tutor</h1>
        <p className="muted">
          {mode === "login" ? "Log in to solve Karnaugh maps step by step." : "Create an account to get started."}
        </p>
        <form onSubmit={submit}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary">{mode === "login" ? "Log in" : "Create account"}</button>
        </form>
        <button type="button" className="link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
        </button>
      </div>
    </div>
  );
}

/* ---------- K-map ---------- */
function KMapGrid({ kmap, groups }) {
  const ringsFor = (m) => {
    const rings = groups.map((g, i) => (g.minterms.includes(m) ? COLORS[i % COLORS.length] : null)).filter(Boolean);
    return rings.map((c, i) => `inset 0 0 0 ${2 + i * 3}px ${c}`).join(", ");
  };
  return (
    <table className="kmap">
      <thead>
        <tr>
          <th className="corner">{kmap.rowVars}\{kmap.colVars}</th>
          {kmap.colLabels.map((l) => (
            <th key={l}>{l}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {kmap.grid.map((row, r) => (
          <tr key={r}>
            <th>{kmap.rowLabels[r]}</th>
            {row.map((cell) => (
              <td key={cell.m} style={{ boxShadow: ringsFor(cell.m) }} className={cell.value === 1 ? "one" : cell.value === "X" ? "dc" : "zero"}>
                {cell.value}
                <small>{cell.m}</small>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------- Solver ---------- */
function Solver({ token, email, onLogout, theme, onToggleTheme }) {
  const [prompt, setPrompt] = useState("");
  const [out, setOut] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(null);
  const [open, setOpen] = useState(() => !isMobile() && localStorage.getItem("sidebar") !== "closed");
  const [menu, setMenu] = useState(null); // { id, x, y } for the ⋯ popup
  const [confirmId, setConfirmId] = useState(null); // chat waiting for delete confirmation
  const [deleting, setDeleting] = useState(false);
  const [view, setView] = useState("solve"); // "solve" | "editor" | "quiz"
  const taRef = useRef(null);

  const guard = (err) => (err.status === 401 ? onLogout() : setError(err.message));
  const loadHistory = () => api("/kmap/history", { token }).then(setHistory).catch(guard);
  useEffect(() => { loadHistory(); }, []);

  // Grow the textarea with its content (max 200px)
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [prompt, out]);

  // Esc closes the popup/dialog; click elsewhere or resize closes the popup
  useEffect(() => {
    if (!menu && !confirmId) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setMenu(null);
      if (!deleting) setConfirmId(null);
    };
    const closeMenu = () => setMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
    };
  }, [menu, confirmId, deleting]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!isMobile()) localStorage.setItem("sidebar", next ? "open" : "closed");
  }

  function newSolve() {
    setView("solve");
    setOut(null);
    setCurrentId(null);
    setPrompt("");
    setError("");
    setActive(null);
    if (isMobile()) setOpen(false);
  }

  function openHistory(h) {
    setView("solve");
    setOut(h);
    setCurrentId(h._id);
    setActive(null);
    setError("");
    if (isMobile()) setOpen(false);
  }

  function openMenu(e, id) {
    e.stopPropagation();
    if (menu?.id === id) return setMenu(null);
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ id, x: r.right, y: r.bottom + 4 });
  }

  async function removeChat() {
    const id = confirmId;
    setDeleting(true);
    try {
      await api(`/kmap/history/${id}`, { method: "DELETE", token });
      setHistory((h) => h.filter((x) => x._id !== id));
      if (currentId === id) newSolve();
    } catch (err) {
      guard(err);
    }
    setDeleting(false);
    setConfirmId(null);
  }

  async function solve(e) {
    e?.preventDefault();
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await api("/kmap/solve", { method: "POST", body: { prompt }, token });
      setOut(res);
      setCurrentId(res.id);
      setActive(null);
      setPrompt("");
      loadHistory();
    } catch (err) {
      guard(err);
    }
    setBusy(false);
  }

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) solve(e);
  };

  const r = out?.result;
  const chosen = r ? r.cover.chosen.map((id) => r.primes.find((p) => p.id === id)) : [];
  const shown = active ? chosen.filter((g) => g.id === active) : chosen;
  const confirmItem = history.find((h) => h._id === confirmId);

  const composer = (
    <form onSubmit={solve} className="composer">
      <textarea
        ref={taRef}
        rows={1}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Σm(0,1,2,5,8,9,10) or: 3 variables, minterms 1,3,5,7, don't cares 0"
        aria-label="Describe the function to solve"
      />
      <button type="submit" className="send" disabled={busy || !prompt.trim()} aria-label="Solve">
        {busy ? (
          <span className="spin" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        )}
      </button>
    </form>
  );

  return (
    <div className={`app ${open ? "" : "collapsed"}`}>
      <aside className="sidebar" aria-label="Recents">
        <button className="newbtn" onClick={newSolve}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New solve
        </button>

        <div className="sidebar-tools">
          <button className={`toolbtn ${view === "editor" ? "on" : ""}`} onClick={() => { setView("editor"); if (isMobile()) setOpen(false); }}>K-map editor</button>
          <button className={`toolbtn ${view === "quiz" ? "on" : ""}`} onClick={() => { setView("quiz"); if (isMobile()) setOpen(false); }}>Practice quiz</button>
        </div>

        <div className="side-label">Recents</div>
        <ul className="recents" onScroll={() => setMenu(null)}>
          {history.map((h) => (
            <li
              key={h._id}
              className={`row ${currentId === h._id ? "on" : ""} ${menu?.id === h._id ? "menu-open" : ""}`}
            >
              <button className="item" title={h.prompt} onClick={() => openHistory(h)}>
                {h.prompt}
              </button>
              <button
                className="more"
                aria-label="Chat options"
                aria-haspopup="menu"
                aria-expanded={menu?.id === h._id}
                onClick={(e) => openMenu(e, h._id)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
            </li>
          ))}
          {history.length === 0 && <li className="none">Solved problems show up here.</li>}
        </ul>

        <div className="side-foot">
          <span title={email}>{email}</span>
          <button className="logout" onClick={onLogout}>Log out</button>
        </div>
      </aside>

      <div className="backdrop" onClick={toggle} />

      <div className="chat">
        <div className="topbar">
          <button className="icon" onClick={toggle} aria-label={open ? "Close sidebar" : "Open sidebar"} aria-expanded={open}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <path d="M9 4v16" />
            </svg>
          </button>
          <strong>K-map tutor</strong>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>

        {view === "editor" ? (
          <Editor api={api} token={token} onSolved={(res) => { setOut(res); setCurrentId(res.id); setActive(null); setView("solve"); loadHistory(); }} />
        ) : view === "quiz" ? (
          <Quiz api={api} token={token} />
        ) : r ? (
          <>
            <div className="stage">
              <div className="content">
                <div className="asked-row">
                  <p className="asked">{out.prompt}</p>
                </div>
                <section>
                  <p className="result">F = {r.cover.expression}</p>
                  <KMapGrid kmap={r.kmap} groups={shown} />
                  <ul className="groups">
                    {chosen.map((g, i) => (
                      <li key={g.id} className={active === g.id ? "on" : ""} onClick={() => setActive(active === g.id ? null : g.id)}>
                        <i style={{ background: COLORS[i % COLORS.length] }} />
                        <b>{g.term}</b> cells {g.covers.join(", ")}
                        {r.cover.essential.some((e) => e.id === g.id) && <span className="muted"> · essential</span>}
                      </li>
                    ))}
                  </ul>
                  <div className="explain">{out.explanation}</div>
                  <Extras out={out} />
                  <p className="muted small">
                    {r.verification.equivalent ? "Checked against the truth table." : "Verification failed."} {out.mode === "offline" && "Offline solver (no API key set)."}
                  </p>
                </section>
              </div>
            </div>
            <div className="dock">
              {error && <p className="error center">{error}</p>}
              {composer}
            </div>
          </>
        ) : (
          <div className="stage hero">
            <h1>What should we minimize?</h1>
            <p className="sub">Describe a function and get the K-map, groups and steps.</p>
            {composer}
            {error && <p className="error center">{error}</p>}
          </div>
        )}
      </div>

      {/* ⋯ popup menu */}
      {menu && (
        <div
          className="menu"
          role="menu"
          style={{ top: menu.y, left: Math.max(8, menu.x - 160) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            role="menuitem"
            className="danger"
            onClick={() => {
              setConfirmId(menu.id);
              setMenu(null);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
            </svg>
            Delete
          </button>
        </div>
      )}

      {/* delete confirmation dialog */}
      {confirmId && (
        <div className="modal-back" onClick={() => !deleting && setConfirmId(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="del-title">Delete chat?</h2>
            <p>
              Are you sure you want to delete this chat? This can't be undone.
              {confirmItem && <span className="name">{confirmItem.prompt}</span>}
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmId(null)} disabled={deleting} autoFocus>Cancel</button>
              <button className="btn danger-fill" onClick={removeChat} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- App ---------- */
export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem("session") || "null"));
  const set = (token, email) => { const s = { token, email }; localStorage.setItem("session", JSON.stringify(s)); setSession(s); };
  const clear = () => { localStorage.removeItem("session"); setSession(null); };

  return session ? (
    <Solver token={session.token} email={session.email} onLogout={clear} theme={theme} onToggleTheme={toggleTheme} />
  ) : (
    <Auth onAuth={set} theme={theme} onToggleTheme={toggleTheme} />
  );
}