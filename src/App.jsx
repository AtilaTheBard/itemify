import { useState, useEffect, useRef, useCallback } from 'react'
import { useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakToggle, TweakColor } from './TweaksPanel'
import './App.css'

/* ----------------------- tweak defaults ----------------------- */
const TWEAK_DEFAULTS = {
  "accent": "#ff7849",
  "voteWindowSeconds": 30,
  "autoPlaylistEvery": 3,
  "autoQueueWhenEmpty": true,
  "denseQueue": false
};

const ACCENT_OPTIONS = [
  "#ff7849",
  "#4ade80",
  "#7aa2ff",
  "#c4b5fd",
  "#fcd34d"
];

/* ----------------------- helpers ----------------------- */
function extractVideoId(url) {
  if (!url) return null;
  url = url.trim();
  const patterns = [
    /(?:youtube\.com\/watch\?(?:[^&]*&)*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/v\/)([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function uid() { return Math.random().toString(36).slice(2, 9); }

function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 8;
  return `av-c${h + 1}`;
}

function initials(name) {
  return name.replace(/^@/, "").slice(0, 2).toUpperCase();
}

/* ----------------------- session name generator ----------------------- */
const SESSION_ANIMALS = [
  "bunny", "bear", "fox", "otter", "wolf", "panda", "koala",
  "lynx", "owl", "deer", "moose", "tiger", "lion", "puma",
  "seal", "whale", "dolphin", "raven", "eagle", "hawk",
  "rabbit", "badger", "ferret", "raccoon", "squirrel", "moth",
  "fawn", "robin", "swan", "heron", "crane", "magpie",
];
function randomSessionName() {
  return SESSION_ANIMALS[Math.floor(Math.random() * SESSION_ANIMALS.length)];
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ----------------------- YouTube IFrame API ----------------------- */
let _ytPromise = null;
function loadYT() {
  if (_ytPromise) return _ytPromise;
  _ytPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) try { prev(); } catch (e) {}
      resolve(window.YT);
    };
  });
  return _ytPromise;
}

/* ----------------------- playlist algorithm ----------------------- */
function generatePlaylist(history, seedNumber = 0) {
  const kept = history.filter((t) => t.verdict === "kept");
  if (kept.length < 3) return null;

  const strategies = [
    () => {
      const recent = kept.filter((t) => Date.now() - (t.playedAt || 0) < 35 * 60000);
      const pool = recent.length >= 3 ? recent : kept;
      return {
        title: "Az önce sevdikleriniz",
        sub: "son yarım saat içinde devam dediğiniz şarkılardan",
        tracks: shuffle(pool).slice(0, 4)
      };
    },
    () => {
      const counts = {};
      kept.forEach((t) => { counts[t.requester.name] = (counts[t.requester.name] || 0) + 1; });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      const who = top && top[1] >= 2 ? top[0] : null;
      const pool = who ? kept.filter((t) => t.requester.name === who) : kept;
      const display = who ? `${who}'ın seçimleri` : "Topluluk favorileri";
      return {
        title: display,
        sub: who ? `bu akşam ${who} bu şarkıları çaldı, hepsi devam aldı` : "herkesin sevdiği şarkılardan derleme",
        tracks: shuffle(pool).slice(0, 4)
      };
    },
    () => {
      const sorted = kept.slice().sort((a, b) => (a.playedAt || 0) - (b.playedAt || 0));
      return {
        title: "Bu akşamın akışı",
        sub: "oturum baştan beri, yeniden dinlemek için",
        tracks: sorted.slice(0, 4)
      };
    },
    () => ({
      title: "Eski dinlediklerinizden",
      sub: "geçmiş listesinden otomatik derleme · itemify tarafından",
      tracks: shuffle(kept).slice(0, 5)
    })
  ];

  const strat = strategies[seedNumber % strategies.length];
  const result = strat();
  if (!result.tracks || result.tracks.length < 3) return strategies[3]();
  return { id: uid(), ...result, createdAt: Date.now() };
}

/* ----------------------- icons ----------------------- */
const Icon = {
  Link: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1" /></svg>,
  Skip: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 4 16 12 6 20" fill="currentColor" stroke="none" /><line x1="20" y1="5" x2="20" y2="19" /></svg>,
  Keep: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
  Plus: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
  X: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  Refresh: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>,
  Play: () => <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20" /></svg>,
  Stack: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>,
  Sparkle: () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4L12 2zM18 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3zM4 13l.8 2.4L7 16l-2.2.6L4 19l-.8-2.4L1 16l2.2-.6L4 13z" /></svg>,
  Pencil: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  Dice: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/></svg>
};

/* ----------------------- avatar ----------------------- */
function Avatar({ person, size = 22 }) {
  const cls = avatarColor(person.name);
  return (
    <span className={`av ${cls}`} style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) }}>
      {initials(person.name)}
    </span>
  );
}

/* ----------------------- Session name ----------------------- */
function SessionName({ name, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef(null);

  useEffect(() => { if (!editing) setDraft(name); }, [name, editing]);
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== name) onChange(v);
    else setDraft(name);
    setEditing(false);
  };
  const cancel = () => { setDraft(name); setEditing(false); };
  const onKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  };
  const widthCh = Math.max(4, draft.length + 1);

  return (
    <div className={`session-line ${editing ? "editing" : ""}`} onClick={() => !editing && setEditing(true)} title={editing ? "" : "ismi düzenle"}>
      <span className="lbl"><span className="av-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4 21c1.6-4 4.8-6 8-6s6.4 2 8 6"/></svg></span></span>
      <input
        ref={inputRef}
        className="nm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={editing ? commit : undefined}
        onKeyDown={onKey}
        readOnly={!editing}
        maxLength={20}
        spellCheck={false}
        style={{ width: `${widthCh}ch`, cursor: editing ? "text" : "pointer" }}
      />
      <span className="pencil"><Icon.Pencil /></span>
    </div>
  );
}

/* ----------------------- Player Stage ----------------------- */
function PlayerStage({ videoId, started, onEnded, onTitle, onDuration, onTime }) {
  const wrapRef = useRef(null);
  const playerRef = useRef(null);
  const lastVidRef = useRef(videoId);

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    let interval = null;

    loadYT().then((YT) => {
      if (cancelled) return;
      const el = document.createElement("div");
      el.id = "yt-mount";
      wrapRef.current.innerHTML = "";
      wrapRef.current.appendChild(el);

      playerRef.current = new YT.Player(el, {
        videoId,
        playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: (e) => {
            try { e.target.playVideo(); } catch (err) {}
            const d = e.target.getDuration();
            if (d > 0) onDuration(d);
            const data = e.target.getVideoData?.();
            if (data?.title) onTitle(data.title);
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) onEnded();
            if (e.data === YT.PlayerState.PLAYING) {
              const data = e.target.getVideoData?.();
              if (data?.title) onTitle(data.title);
              const d = e.target.getDuration();
              if (d > 0) onDuration(d);
            }
          }
        }
      });

      interval = setInterval(() => {
        const p = playerRef.current;
        if (p && p.getCurrentTime) {
          try { onTime(p.getCurrentTime() || 0); } catch (e) {}
        }
      }, 500);
    });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      try { playerRef.current?.destroy(); } catch (e) {}
      playerRef.current = null;
    };
  }, [started]);

  useEffect(() => {
    if (!started) return;
    if (videoId === lastVidRef.current) return;
    lastVidRef.current = videoId;
    const p = playerRef.current;
    if (p && p.loadVideoById) {
      try { p.loadVideoById(videoId); } catch (e) {}
    }
  }, [videoId, started]);

  return (
    <div className="stage">
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}

/* ----------------------- VoteBar ----------------------- */
function VoteBar({ elapsed, windowSec, skipVotes, keepVotes, myVote, onVote, totalListeners }) {
  const remaining = Math.max(0, windowSec - elapsed);
  const pctElapsed = Math.min(100, elapsed / windowSec * 100);
  const total = skipVotes + keepVotes || 1;
  const skipPct = skipVotes / total * 100;
  const keepPct = keepVotes / total * 100;

  return (
    <div className="vote">
      <div className="vote-grid">
        <div className="vote-head">
          <div className="vote-kicker">
            <span className="lab"><span className="pip"></span>OYLAMA AÇIK · İlk {windowSec} saniye</span>
            <span className="vote-countdown">
              <span className="ring" style={{ "--p": pctElapsed }}></span>
              <span>{Math.ceil(remaining)} sn kaldı</span>
            </span>
          </div>
          <h3 className="vote-q">Bu şarkıyı geçelim mi?</h3>
          <div className="vote-bar-wrap">
            <div className="vote-bar">
              <div className="seg-skip" style={{ flexBasis: `${skipPct}%` }} />
              <div className="seg-keep" style={{ flexBasis: `${keepPct}%` }} />
            </div>
            <div className="vote-counts">
              <span className="c-skip">Geç · {skipVotes}</span>
              <span>{skipVotes + keepVotes} / {totalListeners} dinleyici oyladı</span>
              <span className="c-keep">Devam · {keepVotes}</span>
            </div>
          </div>
        </div>
        <div className="vote-buttons">
          <button className={`btn-vote skip ${myVote === "skip" ? "active" : ""}`} onClick={() => onVote("skip")}>
            <span className="left"><Icon.Skip /> Geç</span>
            <span className="kbd">S</span>
          </button>
          <button className={`btn-vote keep ${myVote === "keep" ? "active" : ""}`} onClick={() => onVote("keep")}>
            <span className="left"><Icon.Keep /> Devam et</span>
            <span className="kbd">D</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------- VoteClosed ----------------------- */
function VoteClosed({ skipVotes, keepVotes, verdict }) {
  return (
    <div className="vote-closed">
      <span className="lab">oylama kapandı</span>
      <span>
        <span className="num">{keepVotes}</span> devam · <span className="num">{skipVotes}</span> geç
        <span style={{ color: "var(--ink-4)", marginLeft: 14 }}>
          {verdict === "kept" ? "şarkı devam ediyor" : "az farkla devam"}
        </span>
      </span>
    </div>
  );
}

/* ----------------------- Track row ----------------------- */
function TrackRow({ track, index, isNext, onRemove, showRemove, dense }) {
  const isAuto = track.source === "auto";
  return (
    <div className={`row ${isNext ? "next" : ""}`}>
      <div className="idx">{isNext ? "↑" : String(index).padStart(2, "0")}</div>
      <div className={`thumb ${isAuto ? "auto" : ""}`}>
        <img src={track.thumb} alt="" loading="lazy" />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="ttl">{track.title}</div>
        {!dense && (
          <div className="mta">
            {isAuto ? (
              <>
                <span className="auto-pill">eski dinlediklerden</span>
                <span className="dot"></span>
                <span>{fmtTime(track.duration)}</span>
              </>
            ) : (
              <>
                <Avatar person={track.requester} size={12} />
                <span>{track.requester.name}</span>
                <span className="dot"></span>
                <span>{fmtTime(track.duration)}</span>
              </>
            )}
          </div>
        )}
      </div>
      {showRemove ? (
        <button className="x-btn" onClick={() => onRemove(track.id)}><Icon.X /></button>
      ) : (
        <span className="dur">{fmtTime(track.duration)}</span>
      )}
    </div>
  );
}

/* ----------------------- Queue panel ----------------------- */
function QueuePanel({ items, onRemove, dense }) {
  if (items.length === 0) {
    return <div className="empty">kuyruk boş — aşağıdan bir bağlantı paylaş</div>;
  }
  return (
    <div className="panel-body">
      {items.map((t, i) => (
        <TrackRow key={t.id} track={t} index={i + 1} isNext={i === 0} onRemove={onRemove} showRemove dense={dense} />
      ))}
    </div>
  );
}

/* ----------------------- Auto-playlist panel ----------------------- */
function PlaylistPanel({ playlist, onAddAll, onRefresh, onPlayOne }) {
  if (!playlist) {
    return (
      <section className="panel">
        <div className="panel-head">
          <div className="head-l"><h3>Eski dinlediklerinden</h3></div>
          <button className="head-btn" onClick={onRefresh}>derle</button>
        </div>
        <div className="empty">birkaç şarkı dinleyince burada otomatik bir derleme görüneceksiniz</div>
      </section>
    );
  }
  return (
    <section className="panel accent">
      <div className="pl-banner">
        <div className="meta">
          <span className="live-mini"></span>
          <span>Daha önce dinledikleriniz</span>
        </div>
        <div className="pl-title">{playlist.title}</div>
        <div className="pl-sub">{playlist.sub}</div>
        <div className="pl-actions">
          <button className="pl-btn primary" onClick={onAddAll}><Icon.Stack /> Tümünü sıraya ekle</button>
          <button className="pl-btn" onClick={onRefresh}><Icon.Refresh /> Yenile</button>
        </div>
      </div>
      <div className="panel-body" style={{ paddingTop: 6 }}>
        {playlist.tracks.map((t, i) => (
          <div key={t.id + "-" + i} className="row" onClick={() => onPlayOne(t)} style={{ cursor: "pointer" }}>
            <div className="idx">{String(i + 1).padStart(2, "0")}</div>
            <div className="thumb auto"><img src={t.thumb} alt="" loading="lazy" /></div>
            <div style={{ minWidth: 0 }}>
              <div className="ttl">{t.title}</div>
              <div className="mta">
                <Avatar person={t.requester} size={12} />
                <span>{t.requester.name}</span>
                <span className="dot"></span>
                <span>{fmtTime(t.duration)}</span>
              </div>
            </div>
            <span className="dur">{fmtTime(t.duration)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------------- History panel ----------------------- */
function HistoryPanel({ items }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="panel">
      <div className="panel-head clickable" onClick={() => setOpen(o => !o)}>
        <div className="head-l">
          <h3>Geçmiş</h3>
          <span className="count">· {items.length} şarkı</span>
        </div>
        <div className="head-r">
          <span className={`chev ${open ? "" : "collapsed"}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        </div>
      </div>
      <div className={`collapsible ${open ? "" : "closed"}`}>
        <div className="panel-body" style={{ padding: "0 8px 10px" }}>
          {items.slice(0, 8).map((t) => (
            <div key={t.id} className="hrow">
              <div className="hthumb"><img src={t.thumb} alt="" loading="lazy" /></div>
              <div style={{ minWidth: 0 }}>
                <div className="ht">{t.title}</div>
                <div className="hm">{t.requester.name} · {t.when}</div>
              </div>
              <span className={`verdict ${t.verdict}`}>
                {t.verdict === "kept" ? "devam" : "geçildi"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------- Dock ----------------------- */
function Dock({ onSubmit }) {
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");

  const submit = (e) => {
    e?.preventDefault();
    const id = extractVideoId(url);
    if (!id) {
      setErr("geçerli bir YouTube bağlantısı değil");
      setTimeout(() => setErr(""), 2500);
      return;
    }
    onSubmit(id);
    setUrl("");
    setErr("");
  };

  return (
    <div className="dock">
      <form className="dock-inner" onSubmit={submit}>
        <span className="dock-icon"><Icon.Link /></span>
        <input
          className="dock-input"
          placeholder="youtube.com/watch?v=…   ·   youtu.be/…"
          value={url}
          onChange={(e) => { setUrl(e.target.value); if (err) setErr(""); }}
          spellCheck={false}
        />
        {err ? <span className="dock-error">{err}</span> : <span className="dock-hint">enter ile gönder</span>}
        <button className="btn-add" disabled={!url.trim()}><Icon.Plus /> sıraya ekle</button>
      </form>
    </div>
  );
}

/* ----------------------- main App ----------------------- */
const ME = { name: randomSessionName(), isMe: true };

export default function App() {
  const [tweaks, setTweaks] = useTweaks(TWEAK_DEFAULTS);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", tweaks.accent);
    const hex = tweaks.accent.replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    document.documentElement.style.setProperty("--accent-soft", `rgba(${r},${g},${b},0.14)`);
  }, [tweaks.accent]);

  const [started, setStarted] = useState(false);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [queue, setQueue] = useState([]);
  const [history, setHistory] = useState([]);
  const [playlistSeed, setPlaylistSeed] = useState(0);
  const [playlist, setPlaylist] = useState(null);
  const [tracksPlayed, setTracksPlayed] = useState(0);
  const [listenersCount] = useState(1);
  const [sessionName, setSessionName] = useState(ME.name);

  useEffect(() => { ME.name = sessionName; }, [sessionName]);

  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);

  const [skipVotes, setSkipVotes] = useState(0);
  const [keepVotes, setKeepVotes] = useState(0);
  const [myVote, setMyVote] = useState(null);
  const autoSkippedRef = useRef(new Set());

  const windowSec = tweaks.voteWindowSeconds ?? 30;
  const voteOpen = started && elapsed < windowSec;
  const verdictGuess = skipVotes > keepVotes ? "skipped" : "kept";

  useEffect(() => {
    if (tracksPlayed === 0) return;
    const every = tweaks.autoPlaylistEvery || 3;
    if (tracksPlayed % every === 0) {
      const next = generatePlaylist(history, playlistSeed + 1);
      if (next) {
        setPlaylist(next);
        setPlaylistSeed((s) => s + 1);
        setToast({ msg: `Yeni derleme hazır · ${next.title}`, kind: "success" });
        setTimeout(() => setToast(null), 3200);
      }
    }
  }, [tracksPlayed]);

  const resetVotes = useCallback(() => {
    setElapsed(0);
    setMyVote(null);
    setSkipVotes(0);
    setKeepVotes(0);
  }, []);

  const playNext = useCallback((verdict = "kept") => {
    setHistory((h) => {
      if (!nowPlaying) return h;
      return [{ ...nowPlaying, verdict, when: "az önce", playedAt: Date.now() }, ...h].slice(0, 12);
    });
    setQueue((q) => {
      const [next, ...rest] = q;
      if (next) {
        setNowPlaying(next);
        return rest;
      }
      if (tweaks.autoQueueWhenEmpty && playlist && playlist.tracks.length) {
        const [first, ...remaining] = playlist.tracks;
        const promoted = { ...first, id: uid(), source: "auto" };
        setNowPlaying(promoted);
        const promotedQueue = remaining.map((t) => ({ ...t, id: uid(), source: "auto" }));
        setToast({ msg: "kuyruk bitti — derlemeden devam ediliyor", kind: "success" });
        setTimeout(() => setToast(null), 3000);
        return promotedQueue;
      }
      setNowPlaying(null);
      return [];
    });
    setTracksPlayed((n) => n + 1);
    resetVotes();
  }, [nowPlaying, resetVotes, playlist, tweaks.autoQueueWhenEmpty]);

  useEffect(() => {
    if (!started || voteOpen) return;
    if (!nowPlaying) return;
    if (skipVotes > keepVotes + 1 && skipVotes >= 3) {
      const id = nowPlaying.id;
      if (!autoSkippedRef.current.has(id)) {
        autoSkippedRef.current.add(id);
        playNext("skipped");
      }
    }
  }, [voteOpen, started]);

  const handleVote = useCallback((v) => {
    setMyVote((cur) => {
      if (cur === "skip") setSkipVotes((x) => Math.max(0, x - 1));
      if (cur === "keep") setKeepVotes((x) => Math.max(0, x - 1));
      if (cur === v) return null;
      if (v === "skip") setSkipVotes((x) => x + 1);
      else setKeepVotes((x) => x + 1);
      return v;
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "s" || e.key === "S") handleVote("skip");
      if (e.key === "d" || e.key === "D") handleVote("keep");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleVote]);

  const submitUrl = useCallback((videoId) => {
    const t = {
      id: uid(),
      videoId,
      title: "yeni istek · oynatınca yüklenir",
      duration: 0,
      requester: ME,
      thumb: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      source: "user"
    };
    if (!nowPlaying) {
      setNowPlaying(t);
      setStarted(true);
      resetVotes();
    } else {
      setQueue((q) => [...q, t]);
    }
    setToast({ msg: "isteğin sıraya eklendi", kind: "success" });
    setTimeout(() => setToast(null), 2500);
  }, [nowPlaying, resetVotes]);

  const removeFromQueue = useCallback((id) => {
    setQueue((q) => q.filter((t) => t.id !== id));
  }, []);

  const addPlaylistAll = useCallback(() => {
    if (!playlist) return;
    const items = playlist.tracks.map((t) => ({ ...t, id: uid(), source: "auto" }));
    if (!nowPlaying && items.length > 0) {
      const [first, ...rest] = items;
      setNowPlaying(first);
      setStarted(true);
      setQueue((q) => [...q, ...rest]);
      resetVotes();
    } else {
      setQueue((q) => [...q, ...items]);
    }
    setToast({ msg: `${items.length} şarkı sıraya eklendi`, kind: "success" });
    setTimeout(() => setToast(null), 2500);
  }, [playlist, nowPlaying, resetVotes]);

  const refreshPlaylist = useCallback(() => {
    const next = generatePlaylist(history, playlistSeed + 1);
    if (next) {
      setPlaylist(next);
      setPlaylistSeed((s) => s + 1);
    }
  }, [history, playlistSeed]);

  const playOneFromPlaylist = useCallback((t) => {
    const item = { ...t, id: uid(), source: "auto" };
    setQueue((q) => [item, ...q]);
    setToast({ msg: "sıranın başına alındı", kind: "success" });
    setTimeout(() => setToast(null), 2000);
  }, []);

  const [toast, setToast] = useState(null);

  const progressPct = duration ? Math.min(100, elapsed / duration * 100) : 0;
  const voteWindowPct = duration ? Math.min(100, windowSec / duration * 100) : 0;

  return (
    <>
      <div className="backdrop"></div>
      <div className="bloom b1"></div>
      <div className="bloom b2"></div>
      <div className="bloom b3"></div>

      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">
              <span className="glyph"></span>
              <span className="wordmark">
                {"itemify".split("").map((c, i) => <span key={i}>{c}</span>)}
              </span>
            </span>
          </div>
          <div className="topbar-meta">
            <div className="listeners-block">
              <span className="live-pill">
                <span className="live-dot"></span>
                <span className="num">{listenersCount}</span>
                <span>dinleyici</span>
              </span>
              <SessionName name={sessionName} onChange={setSessionName} />
            </div>
          </div>
        </header>

        <div className="grid">
          <div>
            <PlayerStage
              started={started}
              videoId={nowPlaying?.videoId}
              onEnded={() => playNext(verdictGuess)}
              onTitle={(t) => setNowPlaying((np) => np && np.title !== t ? { ...np, title: t } : np)}
              onDuration={(d) => {
                setDuration(d);
                setNowPlaying((np) => np ? { ...np, duration: d } : np);
              }}
              onTime={(t) => setElapsed(t)}
            />

            {nowPlaying && (
              <>
                <div className="nowplaying">
                  <div className="np-left">
                    <h2 className="np-title">{nowPlaying.title}</h2>
                  </div>
                  <div className="np-timer">
                    <span className="big">{fmtTime(elapsed)}</span>
                    <span>{fmtTime(duration || nowPlaying.duration)}</span>
                  </div>
                </div>

                <div className="progress">
                  <div className="fill" style={{ transform: `scaleX(${progressPct / 100})` }} />
                  {voteWindowPct > 0 && voteWindowPct < 100 && (
                    <div className="window" style={{ left: 0, width: `${voteWindowPct}%` }} />
                  )}
                </div>

                {started && voteOpen && (
                  <VoteBar
                    elapsed={elapsed}
                    windowSec={windowSec}
                    skipVotes={skipVotes}
                    keepVotes={keepVotes}
                    myVote={myVote}
                    onVote={handleVote}
                    totalListeners={listenersCount}
                  />
                )}
                {started && !voteOpen && (
                  <VoteClosed skipVotes={skipVotes} keepVotes={keepVotes} verdict={verdictGuess} />
                )}
              </>
            )}

            {!nowPlaying && (
              <div style={{
                marginTop: 22, padding: "32px 24px",
                border: "1px dashed var(--line-2)", borderRadius: 14,
                textAlign: "center", color: "var(--ink-3)"
              }}>
                kuyrukta şarkı yok — aşağıdan bir bağlantı paylaş, akış devam etsin
              </div>
            )}
          </div>

          <aside className="side">
            <section className="panel">
              <div className="panel-head">
                <div className="head-l">
                  <h3>Sırada</h3>
                  <span className="count">· {queue.length} şarkı</span>
                </div>
              </div>
              <QueuePanel items={queue} onRemove={removeFromQueue} dense={tweaks.denseQueue} />
            </section>

            <PlaylistPanel
              playlist={playlist}
              onAddAll={addPlaylistAll}
              onRefresh={refreshPlaylist}
              onPlayOne={playOneFromPlaylist}
            />

            <HistoryPanel items={history} />
          </aside>
        </div>

        <Dock onSubmit={submitUrl} />

        {toast && (
          <div className={`toast ${toast.kind || ""}`}>
            <span className="pip"></span>
            <span>{toast.msg}</span>
          </div>
        )}

        <TweaksPanel title="Tweaks">
          <TweakSection label="Görünüm">
            <TweakColor label="Vurgu rengi" value={tweaks.accent} onChange={(v) => setTweaks("accent", v)} options={ACCENT_OPTIONS} />
          </TweakSection>
          <TweakSection label="Oylama">
            <TweakSlider label="Oylama süresi" value={tweaks.voteWindowSeconds} onChange={(v) => setTweaks("voteWindowSeconds", v)} min={10} max={60} step={5} unit=" sn" />
          </TweakSection>
          <TweakSection label="Otomatik derleme">
            <TweakSlider label="Her N şarkıda yenile" value={tweaks.autoPlaylistEvery} onChange={(v) => setTweaks("autoPlaylistEvery", v)} min={2} max={10} step={1} unit=" şarkı" />
            <TweakToggle label="Sıra biterse derlemeden devam et" value={tweaks.autoQueueWhenEmpty} onChange={(v) => setTweaks("autoQueueWhenEmpty", v)} />
          </TweakSection>
          <TweakSection label="Kuyruk">
            <TweakToggle label="Sıkı satır" value={tweaks.denseQueue} onChange={(v) => setTweaks("denseQueue", v)} />
          </TweakSection>
        </TweaksPanel>
      </div>
    </>
  );
}
