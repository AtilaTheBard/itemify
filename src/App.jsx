import { useState, useEffect, useRef, useCallback } from 'react'
import { ref, onValue, set, push, remove, update, get, onDisconnect, query, limitToLast } from 'firebase/database'
import { db } from './firebase'
import { useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakToggle, TweakColor } from './TweaksPanel'
import './App.css'

/* ── constants ───────────────────────────────────────── */
const ROOM = 'main'
const TWEAK_DEFAULTS = {
  accent: '#ff7849',
  voteWindowSeconds: 30,
  autoPlaylistEvery: 3,
  autoQueueWhenEmpty: true,
  denseQueue: false,
}
const ACCENT_OPTIONS = ['#ff7849','#4ade80','#7aa2ff','#c4b5fd','#fcd34d']

/* ── user identity ───────────────────────────────────── */
function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch {} }
function getOrCreate(key, factory) {
  let v = lsGet(key); if (!v) { v = factory(); lsSet(key, v); } return v;
}
const MY_ID = getOrCreate('ify-uid', () => Math.random().toString(36).slice(2, 11))

/* ── helpers ─────────────────────────────────────────── */
function extractVideoId(url) {
  if (!url) return null
  url = url.trim()
  const patterns = [
    /(?:youtube\.com\/watch\?(?:[^&]*&)*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/v\/)([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/
  ]
  for (const p of patterns) { const m = url.match(p); if (m) return m[1] }
  return null
}
function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}
function uid() { return Math.random().toString(36).slice(2, 9) }
function avatarColor(seed) {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 8
  return `av-c${h + 1}`
}
function initials(name) { return name.replace(/^@/, '').slice(0, 2).toUpperCase() }
const SESSION_ANIMALS = [
  'bunny','bear','fox','otter','wolf','panda','koala','lynx','owl','deer',
  'moose','tiger','lion','puma','seal','whale','dolphin','raven','eagle','hawk',
  'rabbit','badger','ferret','raccoon','squirrel','moth','fawn','robin','swan','heron','crane','magpie',
]
function randomSessionName() { return SESSION_ANIMALS[Math.floor(Math.random() * SESSION_ANIMALS.length)] }
function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
  return a
}

/* ── playlist algorithm ──────────────────────────────── */
function generatePlaylist(history, seedNumber = 0) {
  const kept = history.filter(t => t.verdict === 'kept')
  if (kept.length < 3) return null
  const strategies = [
    () => { const r = kept.filter(t => Date.now() - (t.playedAt||0) < 35*60000); const pool = r.length>=3?r:kept; return { title:'Az önce sevdikleriniz', sub:'son yarım saat içinde devam dediğiniz şarkılardan', tracks:shuffle(pool).slice(0,4) } },
    () => { const c={}; kept.forEach(t=>{c[t.requester.name]=(c[t.requester.name]||0)+1}); const top=Object.entries(c).sort((a,b)=>b[1]-a[1])[0]; const who=top&&top[1]>=2?top[0]:null; const pool=who?kept.filter(t=>t.requester.name===who):kept; return { title:who?`${who}'ın seçimleri`:'Topluluk favorileri', sub:who?`bu akşam ${who} bu şarkıları çaldı`:'herkesin sevdiği şarkılardan derleme', tracks:shuffle(pool).slice(0,4) } },
    () => ({ title:'Bu akşamın akışı', sub:'oturum baştan beri', tracks:kept.slice().sort((a,b)=>(a.playedAt||0)-(b.playedAt||0)).slice(0,4) }),
    () => ({ title:'Eski dinlediklerinizden', sub:'geçmiş listesinden otomatik derleme', tracks:shuffle(kept).slice(0,5) })
  ]
  const result = strategies[seedNumber % strategies.length]()
  if (!result.tracks || result.tracks.length < 3) return strategies[3]()
  return { id: uid(), ...result, createdAt: Date.now() }
}

/* ── YouTube API ─────────────────────────────────────── */
let _ytPromise = null
function loadYT() {
  if (_ytPromise) return _ytPromise
  _ytPromise = new Promise(resolve => {
    if (window.YT && window.YT.Player) return resolve(window.YT)
    const tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag)
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { if (prev) try { prev() } catch {} ; resolve(window.YT) }
  })
  return _ytPromise
}

/* ── Icons ───────────────────────────────────────────── */
const Icon = {
  Link:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1"/></svg>,
  Skip:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 4 16 12 6 20" fill="currentColor" stroke="none"/><line x1="20" y1="5" x2="20" y2="19"/></svg>,
  Keep:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Plus:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  X:       () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Refresh: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  Stack:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  Pencil:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  Send:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
}

/* ── Avatar ──────────────────────────────────────────── */
function Avatar({ person, size = 22 }) {
  return (
    <span className={`av ${avatarColor(person.name)}`} style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) }}>
      {initials(person.name)}
    </span>
  )
}

/* ── SessionName ─────────────────────────────────────── */
function SessionName({ name, onChange }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef(null)
  useEffect(() => { if (!editing) setDraft(name) }, [name, editing])
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])
  const commit = () => { const v = draft.trim(); if (v && v !== name) onChange(v); else setDraft(name); setEditing(false) }
  const cancel = () => { setDraft(name); setEditing(false) }
  const onKey = e => { if (e.key==='Enter'){e.preventDefault();commit()} if (e.key==='Escape'){e.preventDefault();cancel()} }
  return (
    <div className={`session-line ${editing?'editing':''}`} onClick={() => !editing && setEditing(true)} title={editing?'':'ismi düzenle'}>
      <span className="lbl"><span className="av-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4 21c1.6-4 4.8-6 8-6s6.4 2 8 6"/></svg></span></span>
      <input ref={inputRef} className="nm" value={draft} onChange={e=>setDraft(e.target.value)} onBlur={editing?commit:undefined} onKeyDown={onKey} readOnly={!editing} maxLength={20} spellCheck={false} style={{ width:`${Math.max(4,draft.length+1)}ch`, cursor:editing?'text':'pointer' }} />
      <span className="pencil"><Icon.Pencil /></span>
    </div>
  )
}

/* ── PlayerStage ─────────────────────────────────────── */
function PlayerStage({ videoId, started, startedAt, onEnded, onTitle, onDuration, onTime }) {
  const wrapRef = useRef(null)
  const playerRef = useRef(null)
  const lastVidRef = useRef(videoId)

  useEffect(() => {
    if (!started) return
    let cancelled = false, interval = null
    loadYT().then(YT => {
      if (cancelled) return
      const el = document.createElement('div')
      wrapRef.current.innerHTML = ''
      wrapRef.current.appendChild(el)
      playerRef.current = new YT.Player(el, {
        videoId,
        playerVars: { autoplay:1, controls:1, modestbranding:1, rel:0, playsinline:1 },
        events: {
          onReady: e => {
            try { e.target.playVideo() } catch {}
            if (startedAt) {
              const seekTo = Math.max(0, (Date.now() - startedAt) / 1000)
              if (seekTo > 2) try { e.target.seekTo(seekTo, true) } catch {}
            }
            const d = e.target.getDuration(); if (d > 0) onDuration(d)
            const data = e.target.getVideoData?.(); if (data?.title) onTitle(data.title)
          },
          onStateChange: e => {
            if (e.data === YT.PlayerState.ENDED) onEnded()
            if (e.data === YT.PlayerState.PLAYING) {
              const data = e.target.getVideoData?.(); if (data?.title) onTitle(data.title)
              const d = e.target.getDuration(); if (d > 0) onDuration(d)
            }
          }
        }
      })
      interval = setInterval(() => { try { onTime(playerRef.current?.getCurrentTime() || 0) } catch {} }, 500)
    })
    return () => { cancelled = true; if (interval) clearInterval(interval); try { playerRef.current?.destroy() } catch {}; playerRef.current = null }
  }, [started])

  useEffect(() => {
    if (!started || videoId === lastVidRef.current) return
    lastVidRef.current = videoId
    const p = playerRef.current
    if (p?.loadVideoById) {
      const seekTo = startedAt ? Math.max(0, (Date.now() - startedAt) / 1000) : 0
      try { p.loadVideoById({ videoId, startSeconds: seekTo }) } catch {}
    }
  }, [videoId, started])

  return <div className="stage"><div ref={wrapRef} style={{ position:'absolute', inset:0 }} /></div>
}

/* ── VoteBar ─────────────────────────────────────────── */
function VoteBar({ elapsed, windowSec, skipVotes, keepVotes, myVote, onVote, totalListeners }) {
  const remaining = Math.max(0, windowSec - elapsed)
  const total = skipVotes + keepVotes || 1
  return (
    <div className="vote">
      <div className="vote-grid">
        <div className="vote-head">
          <div className="vote-kicker">
            <span className="lab"><span className="pip"></span>OYLAMA AÇIK · İlk {windowSec} saniye</span>
            <span className="vote-countdown">
              <span className="ring" style={{ '--p': Math.min(100, elapsed/windowSec*100) }}></span>
              <span>{Math.ceil(remaining)} sn kaldı</span>
            </span>
          </div>
          <h3 className="vote-q">Bu şarkıyı geçelim mi?</h3>
          <div className="vote-bar-wrap">
            <div className="vote-bar">
              <div className="seg-skip" style={{ flexBasis:`${skipVotes/total*100}%` }} />
              <div className="seg-keep" style={{ flexBasis:`${keepVotes/total*100}%` }} />
            </div>
            <div className="vote-counts">
              <span className="c-skip">Geç · {skipVotes}</span>
              <span>{skipVotes+keepVotes} / {totalListeners} oyladı</span>
              <span className="c-keep">Devam · {keepVotes}</span>
            </div>
          </div>
        </div>
        <div className="vote-buttons">
          <button className={`btn-vote skip ${myVote==='skip'?'active':''}`} onClick={()=>onVote('skip')}><span className="left"><Icon.Skip /> Geç</span><span className="kbd">S</span></button>
          <button className={`btn-vote keep ${myVote==='keep'?'active':''}`} onClick={()=>onVote('keep')}><span className="left"><Icon.Keep /> Devam</span><span className="kbd">D</span></button>
        </div>
      </div>
    </div>
  )
}

/* ── VoteClosed ──────────────────────────────────────── */
function VoteClosed({ skipVotes, keepVotes, verdict }) {
  return (
    <div className="vote-closed">
      <span className="lab">oylama kapandı</span>
      <span><span className="num">{keepVotes}</span> devam · <span className="num">{skipVotes}</span> geç<span style={{color:'var(--ink-4)',marginLeft:14}}>{verdict==='kept'?'şarkı devam ediyor':'geçildi'}</span></span>
    </div>
  )
}

/* ── TrackRow ────────────────────────────────────────── */
function TrackRow({ track, index, isNext, onRemove, showRemove, dense }) {
  const isAuto = track.source === 'auto'
  return (
    <div className={`row ${isNext?'next':''}`}>
      <div className="idx">{isNext ? '↑' : String(index).padStart(2,'0')}</div>
      <div className={`thumb ${isAuto?'auto':''}`}><img src={track.thumb} alt="" loading="lazy" /></div>
      <div style={{minWidth:0}}>
        <div className="ttl">{track.title}</div>
        {!dense && (
          <div className="mta">
            {isAuto ? (<><span className="auto-pill">eski dinlediklerden</span><span className="dot"></span><span>{fmtTime(track.duration)}</span></>) : (<><Avatar person={track.requester} size={12} /><span>{track.requester.name}</span><span className="dot"></span><span>{fmtTime(track.duration)}</span></>)}
          </div>
        )}
      </div>
      {showRemove ? <button className="x-btn" onClick={()=>onRemove(track.id)}><Icon.X /></button> : <span className="dur">{fmtTime(track.duration)}</span>}
    </div>
  )
}

/* ── QueuePanel ──────────────────────────────────────── */
function QueuePanel({ items, onRemove, dense }) {
  if (!items.length) return <div className="empty">kuyruk boş — aşağıdan bir bağlantı paylaş</div>
  return (
    <div className="panel-body">
      {items.map((t,i) => <TrackRow key={t.id} track={t} index={i+1} isNext={i===0} onRemove={onRemove} showRemove dense={dense} />)}
    </div>
  )
}

/* ── ChatPanel ───────────────────────────────────────── */
function ChatPanel({ messages, onSend, myId }) {
  const [text, setText] = useState('')
  const bottomRef = useRef(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])
  const submit = e => {
    e?.preventDefault()
    if (!text.trim()) return
    onSend(text.trim()); setText('')
  }
  return (
    <div className="chat-wrap">
      <div className="chat-messages">
        {!messages.length && <div className="empty">henüz mesaj yok — merhaba de!</div>}
        {messages.map((msg, i) => (
          <div key={msg.timestamp+'-'+i} className={`chat-msg ${msg.userId===myId?'mine':''}`}>
            <Avatar person={{ name: msg.name }} size={22} />
            <div className="chat-bubble">
              <span className="chat-name">{msg.name}</span>
              <span className="chat-text">{msg.text}</span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="chat-input-row" onSubmit={submit}>
        <input className="chat-field" placeholder="mesaj yaz…" value={text} onChange={e=>setText(e.target.value)} maxLength={200} />
        <button type="submit" className="chat-send" disabled={!text.trim()}><Icon.Send /></button>
      </form>
    </div>
  )
}

/* ── PlaylistPanel ───────────────────────────────────── */
function PlaylistPanel({ playlist, onAddAll, onRefresh, onPlayOne }) {
  if (!playlist) {
    return (
      <section className="panel">
        <div className="panel-head"><div className="head-l"><h3>Eski dinlediklerinden</h3></div><button className="head-btn" onClick={onRefresh}>derle</button></div>
        <div className="empty">birkaç şarkı dinleyince burada otomatik bir derleme görünecek</div>
      </section>
    )
  }
  return (
    <section className="panel accent">
      <div className="pl-banner">
        <div className="meta"><span className="live-mini"></span><span>Daha önce dinledikleriniz</span></div>
        <div className="pl-title">{playlist.title}</div>
        <div className="pl-sub">{playlist.sub}</div>
        <div className="pl-actions">
          <button className="pl-btn primary" onClick={onAddAll}><Icon.Stack /> Tümünü ekle</button>
          <button className="pl-btn" onClick={onRefresh}><Icon.Refresh /> Yenile</button>
        </div>
      </div>
      <div className="panel-body" style={{paddingTop:6}}>
        {playlist.tracks.map((t,i) => (
          <div key={t.id+'-'+i} className="row" onClick={()=>onPlayOne(t)} style={{cursor:'pointer'}}>
            <div className="idx">{String(i+1).padStart(2,'0')}</div>
            <div className="thumb auto"><img src={t.thumb} alt="" loading="lazy" /></div>
            <div style={{minWidth:0}}><div className="ttl">{t.title}</div><div className="mta"><Avatar person={t.requester} size={12} /><span>{t.requester.name}</span><span className="dot"></span><span>{fmtTime(t.duration)}</span></div></div>
            <span className="dur">{fmtTime(t.duration)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── HistoryPanel ────────────────────────────────────── */
function HistoryPanel({ items }) {
  return (
    <div className="panel-body" style={{padding:'0 8px 10px'}}>
      {!items.length && <div className="empty">henüz şarkı çalınmadı</div>}
      {items.slice(0,20).map(t => (
        <div key={t.id} className="hrow">
          <div className="hthumb"><img src={t.thumb} alt="" loading="lazy" /></div>
          <div style={{minWidth:0}}><div className="ht">{t.title}</div><div className="hm">{t.requester?.name} · {t.when}</div></div>
          <span className={`verdict ${t.verdict}`}>{t.verdict==='kept'?'devam':'geçildi'}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Sidebar ─────────────────────────────────────────── */
function Sidebar({ queue, messages, history, playlist, onRemove, onAddAll, onRefresh, onPlayOne, onSend, myId, dense }) {
  const [tab, setTab] = useState('queue')
  return (
    <aside className="side">
      <div className="tabs">
        <button className={`tab-btn ${tab==='queue'?'active':''}`} onClick={()=>setTab('queue')}>
          Sıra {queue.length > 0 && <span className="tab-count">{queue.length}</span>}
        </button>
        <button className={`tab-btn ${tab==='chat'?'active':''}`} onClick={()=>setTab('chat')}>
          Sohbet {messages.length > 0 && <span className="tab-count">{messages.length}</span>}
        </button>
        <button className={`tab-btn ${tab==='history'?'active':''}`} onClick={()=>setTab('history')}>
          Geçmiş
        </button>
      </div>
      <div className="tab-content">
        {tab === 'queue' && (
          <div className="tab-scroll">
            <div className="panel">
              <div className="panel-head"><div className="head-l"><h3>Sırada</h3><span className="count">· {queue.length} şarkı</span></div></div>
              <QueuePanel items={queue} onRemove={onRemove} dense={dense} />
            </div>
            <PlaylistPanel playlist={playlist} onAddAll={onAddAll} onRefresh={onRefresh} onPlayOne={onPlayOne} />
          </div>
        )}
        {tab === 'chat' && (
          <div className="tab-panel"><ChatPanel messages={messages} onSend={onSend} myId={myId} /></div>
        )}
        {tab === 'history' && (
          <div className="tab-scroll">
            <div className="panel">
              <div className="panel-head"><div className="head-l"><h3>Geçmiş</h3><span className="count">· {history.length} şarkı</span></div></div>
              <HistoryPanel items={history} />
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

/* ── Dock ────────────────────────────────────────────── */
function Dock({ onSubmit }) {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const submit = e => {
    e?.preventDefault()
    const id = extractVideoId(url)
    if (!id) { setErr('geçerli bir YouTube bağlantısı değil'); setTimeout(() => setErr(''), 2500); return }
    onSubmit(id); setUrl(''); setErr('')
  }
  return (
    <div className="dock">
      <form className="dock-inner" onSubmit={submit}>
        <span className="dock-icon"><Icon.Link /></span>
        <input className="dock-input" placeholder="youtube.com/watch?v=…  ·  youtu.be/…" value={url} onChange={e=>{setUrl(e.target.value);if(err)setErr('')}} spellCheck={false} />
        {err ? <span className="dock-error">{err}</span> : <span className="dock-hint">enter</span>}
        <button className="btn-add" disabled={!url.trim()}><Icon.Plus /> Ekle</button>
      </form>
    </div>
  )
}

/* ── App ─────────────────────────────────────────────── */
export default function App() {
  const [tweaks, setTweaks] = useTweaks(TWEAK_DEFAULTS)
  const [myName, setMyName] = useState(() => getOrCreate('ify-name', randomSessionName))

  // Firebase state
  const [nowPlaying, setNowPlaying] = useState(null)
  const [queue, setQueue] = useState([])
  const [skipVotes, setSkipVotes] = useState(0)
  const [keepVotes, setKeepVotes] = useState(0)
  const [myVote, setMyVote] = useState(null)
  const [history, setHistory] = useState([])
  const [messages, setMessages] = useState([])
  const [listenersCount, setListenersCount] = useState(1)

  // Local state
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playlist, setPlaylist] = useState(null)
  const [playlistSeed, setPlaylistSeed] = useState(0)
  const [toast, setToast] = useState(null)

  const nowPlayingRef = useRef(null)
  useEffect(() => { nowPlayingRef.current = nowPlaying }, [nowPlaying])

  // Accent CSS var
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', tweaks.accent)
    const hex = tweaks.accent.replace('#', '')
    const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16)
    document.documentElement.style.setProperty('--accent-soft', `rgba(${r},${g},${b},0.14)`)
  }, [tweaks.accent])

  // Firebase subscriptions
  useEffect(() => {
    const unsubNP = onValue(ref(db, `rooms/${ROOM}/nowPlaying`), snap => {
      const np = snap.val(); setNowPlaying(np); if (np) setElapsed(0)
    })
    const unsubQ = onValue(ref(db, `rooms/${ROOM}/queue`), snap => {
      const data = snap.val() || {}
      setQueue(Object.values(data).sort((a,b) => (a.createdAt||0)-(b.createdAt||0)))
    })
    const unsubV = onValue(ref(db, `rooms/${ROOM}/votes`), snap => {
      const votes = snap.val() || {}; let skip=0, keep=0, my=null
      Object.entries(votes).forEach(([id,v]) => { if(id===MY_ID) my=v; if(v==='skip') skip++; else if(v==='keep') keep++ })
      setSkipVotes(skip); setKeepVotes(keep); setMyVote(my)
    })
    const unsubH = onValue(query(ref(db, `rooms/${ROOM}/history`), limitToLast(20)), snap => {
      const data = snap.val() || {}
      setHistory(Object.values(data).sort((a,b) => (b.playedAt||0)-(a.playedAt||0)))
    })
    const unsubC = onValue(query(ref(db, `rooms/${ROOM}/chat`), limitToLast(100)), snap => {
      const data = snap.val() || {}
      setMessages(Object.values(data).sort((a,b) => (a.timestamp||0)-(b.timestamp||0)))
    })
    const unsubP = onValue(ref(db, `rooms/${ROOM}/presence`), snap => {
      setListenersCount(snap.val() ? Object.keys(snap.val()).length : 1)
    })
    return () => { unsubNP(); unsubQ(); unsubV(); unsubH(); unsubC(); unsubP() }
  }, [])

  // Presence management
  useEffect(() => {
    const presRef = ref(db, `rooms/${ROOM}/presence/${MY_ID}`)
    const connRef = ref(db, '.info/connected')
    const unsub = onValue(connRef, snap => {
      if (snap.val()) { onDisconnect(presRef).remove(); set(presRef, { name: myName, connectedAt: Date.now() }) }
    })
    return () => { unsub(); remove(presRef) }
  }, [myName])

  // 24h chat cleanup on mount
  useEffect(() => {
    const cutoff = Date.now() - 24*60*60*1000
    get(ref(db, `rooms/${ROOM}/chat`)).then(snap => {
      if (!snap.val()) return
      const updates = {}
      snap.forEach(child => { if ((child.val().timestamp||0) < cutoff) updates[`rooms/${ROOM}/chat/${child.key}`] = null })
      if (Object.keys(updates).length) update(ref(db), updates)
    })
  }, [])

  // Generate playlist from history
  useEffect(() => {
    if (history.length >= 3) { const p = generatePlaylist(history, playlistSeed); if (p) setPlaylist(p) }
  }, [history.length])

  // Derived
  const started = !!nowPlaying
  const windowSec = tweaks.voteWindowSeconds ?? 30
  const voteOpen = started && elapsed < windowSec
  const verdictGuess = skipVotes > keepVotes ? 'skipped' : 'kept'

  // Auto-skip when vote window closes
  useEffect(() => {
    if (!started || voteOpen || !nowPlaying) return
    if (skipVotes > keepVotes + 1 && skipVotes >= 3) advanceTrack('skipped')
  }, [voteOpen])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key==='s'||e.key==='S') handleVote('skip')
      if (e.key==='d'||e.key==='D') handleVote('keep')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const showToast = useCallback((msg, kind='success') => {
    setToast({ msg, kind }); setTimeout(() => setToast(null), 2500)
  }, [])

  // Actions
  const advanceTrack = useCallback(async verdict => {
    const currentId = nowPlayingRef.current?.id
    if (!currentId) return
    const snap = await get(ref(db, `rooms/${ROOM}`))
    const room = snap.val() || {}
    if (!room.nowPlaying || room.nowPlaying.id !== currentId) return

    const updates = {}
    const hKey = push(ref(db, `rooms/${ROOM}/history`)).key
    updates[`rooms/${ROOM}/history/${hKey}`] = { ...room.nowPlaying, verdict, playedAt: Date.now(), when: 'az önce' }
    updates[`rooms/${ROOM}/votes`] = null

    const qEntries = Object.entries(room.queue || {}).sort(([,a],[,b]) => (a.createdAt||0)-(b.createdAt||0))
    if (qEntries.length > 0) {
      const [nextKey, nextTrack] = qEntries[0]
      updates[`rooms/${ROOM}/nowPlaying`] = { ...nextTrack, startedAt: Date.now() }
      updates[`rooms/${ROOM}/queue/${nextKey}`] = null
    } else {
      updates[`rooms/${ROOM}/nowPlaying`] = null
    }
    await update(ref(db), updates)
  }, [])

  const handleVote = useCallback(async v => {
    const voteRef = ref(db, `rooms/${ROOM}/votes/${MY_ID}`)
    const snap = await get(voteRef)
    if (snap.val() === v) await remove(voteRef); else await set(voteRef, v)
  }, [])

  const submitUrl = useCallback(async videoId => {
    const track = {
      id: uid(), videoId,
      title: 'yeni istek · oynatınca yüklenir',
      duration: 0,
      requester: { name: myName, id: MY_ID },
      thumb: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      source: 'user',
      createdAt: Date.now(),
    }
    const npSnap = await get(ref(db, `rooms/${ROOM}/nowPlaying`))
    if (!npSnap.val()) {
      await set(ref(db, `rooms/${ROOM}/nowPlaying`), { ...track, startedAt: Date.now() })
    } else {
      await push(ref(db, `rooms/${ROOM}/queue`), track)
    }
    showToast('isteğin sıraya eklendi')
  }, [myName, showToast])

  const removeFromQueue = useCallback(async trackId => {
    const snap = await get(ref(db, `rooms/${ROOM}/queue`))
    if (!snap.val()) return
    const updates = {}
    snap.forEach(child => { if (child.val().id === trackId) updates[`rooms/${ROOM}/queue/${child.key}`] = null })
    if (Object.keys(updates).length) await update(ref(db), updates)
  }, [])

  const sendMessage = useCallback(async text => {
    await push(ref(db, `rooms/${ROOM}/chat`), { userId: MY_ID, name: myName, text, timestamp: Date.now() })
  }, [myName])

  const handleNameChange = useCallback(name => {
    setMyName(name); lsSet('ify-name', name)
  }, [])

  const addPlaylistAll = useCallback(async () => {
    if (!playlist) return
    const now = Date.now()
    const items = playlist.tracks.map((t,i) => ({ ...t, id:uid(), source:'auto', createdAt: now+i }))
    const npSnap = await get(ref(db, `rooms/${ROOM}/nowPlaying`))
    if (!npSnap.val()) {
      const [first,...rest] = items
      await set(ref(db, `rooms/${ROOM}/nowPlaying`), { ...first, startedAt: Date.now() })
      for (const t of rest) await push(ref(db, `rooms/${ROOM}/queue`), t)
    } else {
      for (const t of items) await push(ref(db, `rooms/${ROOM}/queue`), t)
    }
    showToast(`${items.length} şarkı sıraya eklendi`)
  }, [playlist, showToast])

  const refreshPlaylist = useCallback(() => {
    const next = generatePlaylist(history, playlistSeed+1)
    if (next) { setPlaylist(next); setPlaylistSeed(s=>s+1) }
  }, [history, playlistSeed])

  const playOneFromPlaylist = useCallback(async t => {
    const snap = await get(ref(db, `rooms/${ROOM}/queue`))
    const qData = snap.val() || {}
    const minCreatedAt = Object.values(qData).reduce((min,q) => Math.min(min, q.createdAt||Date.now()), Date.now())
    await push(ref(db, `rooms/${ROOM}/queue`), { ...t, id:uid(), source:'auto', createdAt:minCreatedAt-1000 })
    showToast('sıranın başına alındı')
  }, [showToast])

  const progressPct = duration ? Math.min(100, elapsed/duration*100) : 0
  const voteWindowPct = duration ? Math.min(100, windowSec/duration*100) : 0

  return (
    <>
      <div className="backdrop" />
      <div className="bloom b1" /><div className="bloom b2" /><div className="bloom b3" />
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">
              <span className="glyph"></span>
              <span className="wordmark">{'itemify'.split('').map((c,i)=><span key={i}>{c}</span>)}</span>
            </span>
          </div>
          <div className="topbar-meta">
            <div className="listeners-block">
              <span className="live-pill"><span className="live-dot"></span><span className="num">{listenersCount}</span><span>dinleyici</span></span>
              <SessionName name={myName} onChange={handleNameChange} />
            </div>
          </div>
        </header>

        <div className="grid">
          <div className="main-col">
            <PlayerStage
              started={started}
              videoId={nowPlaying?.videoId}
              startedAt={nowPlaying?.startedAt}
              onEnded={() => advanceTrack(verdictGuess)}
              onTitle={t => setNowPlaying(np => np && np.title!==t ? {...np,title:t} : np)}
              onDuration={d => { setDuration(d); setNowPlaying(np => np ? {...np,duration:d} : np) }}
              onTime={t => setElapsed(t)}
            />

            {nowPlaying && (
              <>
                <div className="nowplaying">
                  <div className="np-left">
                    <h2 className="np-title">{nowPlaying.title}</h2>
                  </div>
                  <div className="np-timer">
                    <span className="big">{fmtTime(elapsed)}</span>
                    <span>{fmtTime(duration||nowPlaying.duration)}</span>
                  </div>
                </div>
                <div className="progress">
                  <div className="fill" style={{ transform:`scaleX(${progressPct/100})` }} />
                  {voteWindowPct > 0 && voteWindowPct < 100 && <div className="window" style={{ left:0, width:`${voteWindowPct}%` }} />}
                </div>
                {voteOpen && <VoteBar elapsed={elapsed} windowSec={windowSec} skipVotes={skipVotes} keepVotes={keepVotes} myVote={myVote} onVote={handleVote} totalListeners={listenersCount} />}
                {!voteOpen && <VoteClosed skipVotes={skipVotes} keepVotes={keepVotes} verdict={verdictGuess} />}
              </>
            )}

            {!nowPlaying && (
              <div style={{ marginTop:22, padding:'32px 24px', border:'1px dashed rgba(255,255,255,0.12)', borderRadius:14, textAlign:'center', color:'var(--ink-3)' }}>
                kuyrukta şarkı yok — aşağıdan bir YouTube bağlantısı paylaş
              </div>
            )}
          </div>

          <Sidebar
            queue={queue} messages={messages} history={history} playlist={playlist}
            onRemove={removeFromQueue} onAddAll={addPlaylistAll} onRefresh={refreshPlaylist}
            onPlayOne={playOneFromPlaylist} onSend={sendMessage} myId={MY_ID} dense={tweaks.denseQueue}
          />
        </div>

        <Dock onSubmit={submitUrl} />

        {toast && (
          <div className={`toast ${toast.kind||''}`}><span className="pip"></span><span>{toast.msg}</span></div>
        )}

        <TweaksPanel title="Tweaks">
          <TweakSection label="Görünüm">
            <TweakColor label="Vurgu rengi" value={tweaks.accent} onChange={v=>setTweaks('accent',v)} options={ACCENT_OPTIONS} />
          </TweakSection>
          <TweakSection label="Oylama">
            <TweakSlider label="Oylama süresi" value={tweaks.voteWindowSeconds} onChange={v=>setTweaks('voteWindowSeconds',v)} min={10} max={60} step={5} unit=" sn" />
          </TweakSection>
          <TweakSection label="Otomatik derleme">
            <TweakSlider label="Her N şarkıda yenile" value={tweaks.autoPlaylistEvery} onChange={v=>setTweaks('autoPlaylistEvery',v)} min={2} max={10} step={1} unit=" şarkı" />
            <TweakToggle label="Sıra biterse derlemeden devam et" value={tweaks.autoQueueWhenEmpty} onChange={v=>setTweaks('autoQueueWhenEmpty',v)} />
          </TweakSection>
          <TweakSection label="Kuyruk">
            <TweakToggle label="Sıkı satır" value={tweaks.denseQueue} onChange={v=>setTweaks('denseQueue',v)} />
          </TweakSection>
        </TweaksPanel>
      </div>
    </>
  )
}
