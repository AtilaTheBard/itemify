import { useState, useEffect, useRef, useCallback } from 'react'
import { ref, onValue, set, push, remove, update, get, onDisconnect, query, limitToLast } from 'firebase/database'
import { db } from './firebase'
import { useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakToggle, TweakColor } from './TweaksPanel'
import './App.css'

/* ── constants ───────────────────────────────────────── */
const TWEAK_DEFAULTS = { accent:'#ff7849', voteWindowSeconds:30, autoPlaylistEvery:3, autoQueueWhenEmpty:true, denseQueue:false }
const ACCENT_OPTIONS = ['#ff7849','#4ade80','#7aa2ff','#c4b5fd','#fcd34d']
const ROOM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/* ── user identity ───────────────────────────────────── */
function lsGet(k) { try { return localStorage.getItem(k) } catch { return null } }
function lsSet(k, v) { try { localStorage.setItem(k, v) } catch {} }
function getOrCreate(k, f) { let v = lsGet(k); if (!v) { v = f(); lsSet(k, v) } return v }
const MY_ID = getOrCreate('ify-uid', () => Math.random().toString(36).slice(2, 11))

/* ── helpers ─────────────────────────────────────────── */
function extractVideoId(url) {
  if (!url) return null; url = url.trim()
  const ps = [/(?:youtube\.com\/watch\?(?:[^&]*&)*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/v\/)([A-Za-z0-9_-]{11})/, /^([A-Za-z0-9_-]{11})$/]
  for (const p of ps) { const m = url.match(p); if (m) return m[1] }
  return null
}
function fmtTime(s) { if (!Number.isFinite(s)||s<0) s=0; return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}` }
function uid() { return Math.random().toString(36).slice(2,9) }
function avatarColor(seed) { let h=0; for (let i=0;i<seed.length;i++) h=(h*31+seed.charCodeAt(i))%8; return `av-c${h+1}` }
function initials(name) { return name.replace(/^@/,'').slice(0,2).toUpperCase() }
const SESSION_ANIMALS = ['bunny','bear','fox','otter','wolf','panda','koala','lynx','owl','deer','moose','tiger','lion','puma','seal','whale','dolphin','raven','eagle','hawk','rabbit','badger','ferret','raccoon','squirrel','moth','fawn','robin','swan','heron','crane','magpie']
function randomSessionName() { return SESSION_ANIMALS[Math.floor(Math.random()*SESSION_ANIMALS.length)] }
function shuffle(arr) { const a=arr.slice(); for (let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]] } return a }
function generateRoomCode() { return Array.from({length:6},()=>ROOM_CHARS[Math.floor(Math.random()*ROOM_CHARS.length)]).join('') }

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth <= 768)
  useEffect(() => { const h = () => setM(window.innerWidth <= 768); window.addEventListener('resize',h); return ()=>window.removeEventListener('resize',h) }, [])
  return m
}

/* ── playlist algorithm ──────────────────────────────── */
function generatePlaylist(history, seed=0) {
  const kept = history.filter(t=>t.verdict==='kept'); if (kept.length<3) return null
  const ss = [
    ()=>{const r=kept.filter(t=>Date.now()-(t.playedAt||0)<35*60000);const p=r.length>=3?r:kept;return{title:'Az önce sevdikleriniz',sub:'son yarım saat içinde devam dediğiniz şarkılardan',tracks:shuffle(p).slice(0,4)}},
    ()=>{const c={};kept.forEach(t=>{c[t.requester.name]=(c[t.requester.name]||0)+1});const top=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];const who=top&&top[1]>=2?top[0]:null;const p=who?kept.filter(t=>t.requester.name===who):kept;return{title:who?`${who}'ın seçimleri`:'Topluluk favorileri',sub:who?`bu akşam ${who} bu şarkıları çaldı`:'herkesin sevdiği şarkılardan',tracks:shuffle(p).slice(0,4)}},
    ()=>({title:'Bu akşamın akışı',sub:'oturum baştan beri',tracks:kept.slice().sort((a,b)=>(a.playedAt||0)-(b.playedAt||0)).slice(0,4)}),
    ()=>({title:'Eski dinlediklerinizden',sub:'geçmiş listesinden otomatik derleme',tracks:shuffle(kept).slice(0,5)})
  ]
  const r=ss[seed%ss.length](); if(!r.tracks||r.tracks.length<3) return ss[3]()
  return {id:uid(),...r,createdAt:Date.now()}
}

/* ── YouTube API ─────────────────────────────────────── */
let _ytPromise=null
function loadYT() {
  if (_ytPromise) return _ytPromise
  _ytPromise=new Promise(resolve=>{
    if (window.YT&&window.YT.Player) return resolve(window.YT)
    const t=document.createElement('script');t.src='https://www.youtube.com/iframe_api';document.head.appendChild(t)
    const prev=window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady=()=>{if(prev)try{prev()}catch{};resolve(window.YT)}
  })
  return _ytPromise
}

/* ── Icons ───────────────────────────────────────────── */
const Icon = {
  Link:    ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1"/></svg>,
  Skip:    ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 4 16 12 6 20" fill="currentColor" stroke="none"/><line x1="20" y1="5" x2="20" y2="19"/></svg>,
  Keep:    ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Plus:    ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  X:       ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Refresh: ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  Stack:   ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  Pencil:  ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  Send:    ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  Search:  ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Share:   ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  Power:   ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>,
}

/* ── Avatar ──────────────────────────────────────────── */
function Avatar({person,size=22}) {
  return <span className={`av ${avatarColor(person.name)}`} style={{width:size,height:size,fontSize:Math.max(8,Math.round(size*0.42))}}>{initials(person.name)}</span>
}

/* ── Landing screen ──────────────────────────────────── */
function Landing({onJoin,onCreate}) {
  const [chars, setChars] = useState(['','','','','',''])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputs = useRef([])

  const handleChar = (i, val) => {
    const c = val.toUpperCase().replace(/[^A-Z0-9]/g,'')
    if (!c && val !== '') return
    const next = [...chars]; next[i] = c.slice(-1); setChars(next); setError('')
    if (c && i < 5) inputs.current[i+1]?.focus()
  }

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !chars[i] && i > 0) {
      const next = [...chars]; next[i-1]=''; setChars(next); inputs.current[i-1]?.focus()
    }
    if (e.key === 'Enter') doJoin()
  }

  const handlePaste = e => {
    e.preventDefault()
    const p = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6)
    const next = [...chars]; p.split('').forEach((c,i)=>{ if(i<6) next[i]=c }); setChars(next)
    inputs.current[Math.min(p.length,5)]?.focus()
  }

  const doJoin = async () => {
    const code = chars.join('')
    if (code.length !== 6) { setError('6 karakter girmelisiniz'); return }
    setLoading(true)
    try {
      const snap = await get(ref(db,`rooms/${code}/meta/closed`))
      if (snap.val() === true) { setError('Bu oda kapalı'); setLoading(false); return }
    } catch {}
    onJoin(code); setLoading(false)
  }

  const full = chars.join('').length === 6

  return (
    <div className="landing">
      <div className="backdrop"/><div className="bloom b1"/><div className="bloom b2"/><div className="bloom b3"/>
      <div className="land-card">
        <div className="land-logo">
          <span className="glyph land-glyph"></span>
          <span className="land-wordmark">{'itemify'.split('').map((c,i)=><span key={i}>{c}</span>)}</span>
        </div>
        <p className="land-label">Oda numarasını girin</p>
        <div className="code-boxes" onPaste={handlePaste}>
          {chars.map((c,i) => (
            <span key={i} className={i===3?'code-group-start':''}>
              <input
                ref={el => inputs.current[i]=el}
                className={`code-box ${c?'filled':''}`}
                value={c}
                onChange={e=>handleChar(i,e.target.value)}
                onKeyDown={e=>handleKeyDown(i,e)}
                maxLength={2}
                autoComplete="off"
                spellCheck={false}
              />
            </span>
          ))}
        </div>
        {error && <p className="land-error">{error}</p>}
        <button className="land-btn primary" onClick={doJoin} disabled={!full||loading}>
          {loading ? 'kontrol ediliyor…' : 'Odaya Gir'}
        </button>
        <div className="land-or"><span>ya da</span></div>
        <button className="land-btn" onClick={onCreate}>Yeni Oda Oluştur</button>
      </div>
    </div>
  )
}

/* ── SessionName ─────────────────────────────────────── */
function SessionName({name,onChange}) {
  const [editing,setEditing]=useState(false)
  const [draft,setDraft]=useState(name)
  const inputRef=useRef(null)
  useEffect(()=>{if(!editing)setDraft(name)},[name,editing])
  useEffect(()=>{if(editing){inputRef.current?.focus();inputRef.current?.select()}},[editing])
  const commit=()=>{const v=draft.trim();if(v&&v!==name)onChange(v);else setDraft(name);setEditing(false)}
  const cancel=()=>{setDraft(name);setEditing(false)}
  const onKey=e=>{if(e.key==='Enter'){e.preventDefault();commit()}if(e.key==='Escape'){e.preventDefault();cancel()}}
  return (
    <div className={`session-line ${editing?'editing':''}`} onClick={()=>!editing&&setEditing(true)} title={editing?'':'ismi düzenle'}>
      <span className="lbl"><span className="av-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4 21c1.6-4 4.8-6 8-6s6.4 2 8 6"/></svg></span></span>
      <input ref={inputRef} className="nm" value={draft} onChange={e=>setDraft(e.target.value)} onBlur={editing?commit:undefined} onKeyDown={onKey} readOnly={!editing} maxLength={20} spellCheck={false} style={{width:`${Math.max(4,draft.length+1)}ch`,cursor:editing?'text':'pointer'}}/>
      <span className="pencil"><Icon.Pencil/></span>
    </div>
  )
}

/* ── PlayerStage ─────────────────────────────────────── */
function PlayerStage({videoId,started,startedAt,onEnded,onTitle,onDuration,onTime}) {
  const wrapRef=useRef(null), playerRef=useRef(null), lastVidRef=useRef(videoId)
  useEffect(()=>{
    if(!started)return
    let cancelled=false,interval=null
    loadYT().then(YT=>{
      if(cancelled)return
      const el=document.createElement('div')
      wrapRef.current.innerHTML=''; wrapRef.current.appendChild(el)
      playerRef.current=new YT.Player(el,{
        videoId,
        playerVars:{autoplay:1,controls:1,modestbranding:1,rel:0,playsinline:1},
        events:{
          onReady:e=>{
            try{e.target.playVideo()}catch{}
            if(startedAt){const s=Math.max(0,(Date.now()-startedAt)/1000);if(s>2)try{e.target.seekTo(s,true)}catch{}}
            const d=e.target.getDuration();if(d>0)onDuration(d)
            const data=e.target.getVideoData?.();if(data?.title)onTitle(data.title)
          },
          onStateChange:e=>{
            if(e.data===YT.PlayerState.ENDED)onEnded()
            if(e.data===YT.PlayerState.PLAYING){const data=e.target.getVideoData?.();if(data?.title)onTitle(data.title);const d=e.target.getDuration();if(d>0)onDuration(d)}
          }
        }
      })
      interval=setInterval(()=>{try{onTime(playerRef.current?.getCurrentTime()||0)}catch{}},500)
    })
    return()=>{cancelled=true;if(interval)clearInterval(interval);try{playerRef.current?.destroy()}catch{};playerRef.current=null}
  },[started])
  useEffect(()=>{
    if(!started||videoId===lastVidRef.current)return
    lastVidRef.current=videoId
    const p=playerRef.current
    if(p?.loadVideoById){const s=startedAt?Math.max(0,(Date.now()-startedAt)/1000):0;try{p.loadVideoById({videoId,startSeconds:s})}catch{}}
  },[videoId,started])
  return <div className="stage"><div ref={wrapRef} style={{position:'absolute',inset:0}}/></div>
}

/* ── VoteBar ─────────────────────────────────────────── */
function VoteBar({elapsed,windowSec,skipVotes,keepVotes,myVote,onVote,totalListeners}) {
  const remaining=Math.max(0,windowSec-elapsed), total=skipVotes+keepVotes||1
  return (
    <div className="vote">
      <div className="vote-grid">
        <div className="vote-head">
          <div className="vote-kicker">
            <span className="lab"><span className="pip"></span>OYLAMA AÇIK · İlk {windowSec}sn</span>
            <span className="vote-countdown"><span className="ring" style={{'--p':Math.min(100,elapsed/windowSec*100)}}></span><span>{Math.ceil(remaining)}sn</span></span>
          </div>
          <h3 className="vote-q">Bu şarkıyı geçelim mi?</h3>
          <div className="vote-bar-wrap">
            <div className="vote-bar"><div className="seg-skip" style={{flexBasis:`${skipVotes/total*100}%`}}/><div className="seg-keep" style={{flexBasis:`${keepVotes/total*100}%`}}/></div>
            <div className="vote-counts"><span className="c-skip">Geç·{skipVotes}</span><span>{skipVotes+keepVotes}/{totalListeners}</span><span className="c-keep">Devam·{keepVotes}</span></div>
          </div>
        </div>
        <div className="vote-buttons">
          <button className={`btn-vote skip ${myVote==='skip'?'active':''}`} onClick={()=>onVote('skip')}><span className="left"><Icon.Skip/>Geç</span><span className="kbd">S</span></button>
          <button className={`btn-vote keep ${myVote==='keep'?'active':''}`} onClick={()=>onVote('keep')}><span className="left"><Icon.Keep/>Devam</span><span className="kbd">D</span></button>
        </div>
      </div>
    </div>
  )
}

/* ── VoteClosed ──────────────────────────────────────── */
function VoteClosed({skipVotes,keepVotes,verdict}) {
  return (
    <div className="vote-closed">
      <span className="lab">oylama kapandı</span>
      <span><span className="num">{keepVotes}</span>devam·<span className="num">{skipVotes}</span>geç<span style={{color:'var(--ink-4)',marginLeft:10}}>{verdict==='kept'?'şarkı devam ediyor':'geçildi'}</span></span>
    </div>
  )
}

/* ── TrackRow + QueuePanel ───────────────────────────── */
function TrackRow({track,index,isNext,onRemove,showRemove,dense}) {
  const isAuto=track.source==='auto'
  return (
    <div className={`row ${isNext?'next':''}`}>
      <div className="idx">{isNext?'↑':String(index).padStart(2,'0')}</div>
      <div className={`thumb ${isAuto?'auto':''}`}><img src={track.thumb} alt="" loading="lazy"/></div>
      <div style={{minWidth:0}}>
        <div className="ttl">{track.title}</div>
        {!dense&&<div className="mta">{isAuto?(<><span className="auto-pill">eski dinlediklerden</span><span className="dot"></span><span>{fmtTime(track.duration)}</span></>):(<><Avatar person={track.requester} size={12}/><span>{track.requester.name}</span><span className="dot"></span><span>{fmtTime(track.duration)}</span></>)}</div>}
      </div>
      {showRemove?<button className="x-btn" onClick={()=>onRemove(track.id)}><Icon.X/></button>:<span className="dur">{fmtTime(track.duration)}</span>}
    </div>
  )
}
function QueuePanel({items,onRemove,dense}) {
  if(!items.length) return <div className="empty">kuyruk boş — aşağıdan bir bağlantı paylaş</div>
  return <div className="panel-body">{items.map((t,i)=><TrackRow key={t.id} track={t} index={i+1} isNext={i===0} onRemove={onRemove} showRemove dense={dense}/>)}</div>
}

/* ── ChatPanel ───────────────────────────────────────── */
function ChatPanel({messages,onSend,myId}) {
  const [text,setText]=useState('')
  const bottomRef=useRef(null)
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth'})},[messages.length])
  const submit=e=>{e?.preventDefault();if(!text.trim())return;onSend(text.trim());setText('')}
  return (
    <div className="chat-wrap">
      <div className="chat-messages">
        {!messages.length&&<div className="empty">henüz mesaj yok — merhaba de!</div>}
        {messages.map((msg,i)=>(
          <div key={msg.timestamp+'-'+i} className={`chat-msg ${msg.userId===myId?'mine':''}`}>
            <Avatar person={{name:msg.name}} size={22}/>
            <div className="chat-bubble"><span className="chat-name">{msg.name}</span><span className="chat-text">{msg.text}</span></div>
          </div>
        ))}
        <div ref={bottomRef}/>
      </div>
      <form className="chat-input-row" onSubmit={submit}>
        <input className="chat-field" placeholder="mesaj yaz…" value={text} onChange={e=>setText(e.target.value)} maxLength={200}/>
        <button type="submit" className="chat-send" disabled={!text.trim()}><Icon.Send/></button>
      </form>
    </div>
  )
}

/* ── PlaylistPanel ───────────────────────────────────── */
function PlaylistPanel({playlist,onAddAll,onRefresh,onPlayOne}) {
  if(!playlist) return (
    <section className="panel">
      <div className="panel-head"><div className="head-l"><h3>Eski dinlediklerinden</h3></div><button className="head-btn" onClick={onRefresh}>derle</button></div>
      <div className="empty">birkaç şarkı dinleyince burada otomatik bir derleme görünecek</div>
    </section>
  )
  return (
    <section className="panel accent">
      <div className="pl-banner">
        <div className="meta"><span className="live-mini"></span><span>Daha önce dinledikleriniz</span></div>
        <div className="pl-title">{playlist.title}</div><div className="pl-sub">{playlist.sub}</div>
        <div className="pl-actions"><button className="pl-btn primary" onClick={onAddAll}><Icon.Stack/>Tümünü ekle</button><button className="pl-btn" onClick={onRefresh}><Icon.Refresh/>Yenile</button></div>
      </div>
      <div className="panel-body" style={{paddingTop:6}}>
        {playlist.tracks.map((t,i)=>(
          <div key={t.id+'-'+i} className="row" onClick={()=>onPlayOne(t)} style={{cursor:'pointer'}}>
            <div className="idx">{String(i+1).padStart(2,'0')}</div>
            <div className="thumb auto"><img src={t.thumb} alt="" loading="lazy"/></div>
            <div style={{minWidth:0}}><div className="ttl">{t.title}</div><div className="mta"><Avatar person={t.requester} size={12}/><span>{t.requester.name}</span><span className="dot"></span><span>{fmtTime(t.duration)}</span></div></div>
            <span className="dur">{fmtTime(t.duration)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── HistoryPanel ────────────────────────────────────── */
function HistoryPanel({items}) {
  return (
    <div className="panel-body" style={{padding:'0 8px 10px'}}>
      {!items.length&&<div className="empty">henüz şarkı çalınmadı</div>}
      {items.slice(0,20).map(t=>(
        <div key={t.id} className="hrow">
          <div className="hthumb"><img src={t.thumb} alt="" loading="lazy"/></div>
          <div style={{minWidth:0}}><div className="ht">{t.title}</div><div className="hm">{t.requester?.name}·{t.when}</div></div>
          <span className={`verdict ${t.verdict}`}>{t.verdict==='kept'?'devam':'geçildi'}</span>
        </div>
      ))}
    </div>
  )
}

/* ── SearchPanel ─────────────────────────────────────── */
function SearchPanel({room,myName,onClose,showToast}) {
  const [query,setQuery]=useState('')
  const [results,setResults]=useState([])
  const [loading,setLoading]=useState(false)
  const [apiKey,setApiKey]=useState(()=>lsGet('ify-yt-key')||'')
  const [keyDraft,setKeyDraft]=useState('')
  const inputRef=useRef(null)

  useEffect(()=>{inputRef.current?.focus()},[])

  const search=async()=>{
    if(!query.trim())return
    setLoading(true);setResults([])
    try {
      const r=await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=8&key=${apiKey}`)
      const d=await r.json()
      if(d.error){showToast(`API hatası: ${d.error.message}`,'');return}
      setResults(d.items||[])
    } catch { showToast('arama başarısız','') }
    setLoading(false)
  }

  const addVideo=async videoId=>{
    const track={id:uid(),videoId,title:'yükleniyor…',duration:0,requester:{name:myName,id:MY_ID},thumb:`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,source:'user',createdAt:Date.now()}
    const npSnap=await get(ref(db,`rooms/${room}/nowPlaying`))
    if(!npSnap.val()) await set(ref(db,`rooms/${room}/nowPlaying`),{...track,startedAt:Date.now()})
    else await push(ref(db,`rooms/${room}/queue`),track)
    showToast('isteğin sıraya eklendi')
    onClose()
  }

  if(!apiKey) return (
    <div className="search-panel">
      <div className="search-apikey">
        <p>YouTube arama için <strong>YouTube Data API v3</strong> anahtarı gerekiyor.<br/><span style={{color:'var(--ink-4)',fontSize:11}}>console.cloud.google.com → YouTube Data API v3 → Credentials</span></p>
        <div className="search-key-row">
          <input className="search-key-input" placeholder="AIza…" value={keyDraft} onChange={e=>setKeyDraft(e.target.value)} onKeyDown={e=>e.key==='Enter'&&keyDraft&&(setApiKey(keyDraft),lsSet('ify-yt-key',keyDraft))}/>
          <button className="search-key-save" onClick={()=>{if(keyDraft){setApiKey(keyDraft);lsSet('ify-yt-key',keyDraft)}}} disabled={!keyDraft}>Kaydet</button>
          <button className="search-key-close" onClick={onClose}><Icon.X/></button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="search-panel">
      <div className="search-bar">
        <span className="search-icon"><Icon.Search/></span>
        <input ref={inputRef} className="search-input" placeholder="YouTube'da ara…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()}/>
        {loading?<span className="search-loading">…</span>:<button className="search-go" onClick={search}>Ara</button>}
        <button className="search-close" onClick={onClose}><Icon.X/></button>
      </div>
      {results.length>0&&(
        <div className="search-results">
          {results.map(item=>(
            <div key={item.id.videoId} className="search-result">
              <img src={item.snippet.thumbnails.default.url} alt="" className="sr-thumb"/>
              <div className="sr-info">
                <div className="sr-title">{item.snippet.title}</div>
                <div className="sr-ch">{item.snippet.channelTitle}</div>
              </div>
              <button className="sr-add" onClick={()=>addVideo(item.id.videoId)}><Icon.Plus/></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Sidebar ─────────────────────────────────────────── */
function Sidebar({queue,messages,history,playlist,onRemove,onAddAll,onRefresh,onPlayOne,onSend,myId,dense}) {
  const isMobile=useIsMobile()
  const [tab,setTab]=useState('queue')

  if(!isMobile) return (
    <aside className="side">
      <div className="side-queue-section">
        <div className="panel-head"><div className="head-l"><h3>Sırada</h3><span className="count">·{queue.length}</span></div></div>
        <QueuePanel items={queue} onRemove={onRemove} dense={dense}/>
        <PlaylistPanel playlist={playlist} onAddAll={onAddAll} onRefresh={onRefresh} onPlayOne={onPlayOne}/>
      </div>
      <div className="side-chat-section">
        <div className="side-chat-head"><h3>Sohbet</h3><span className="count">·{messages.length}</span></div>
        <ChatPanel messages={messages} onSend={onSend} myId={myId}/>
      </div>
    </aside>
  )

  return (
    <aside className="side">
      <div className="tabs">
        <button className={`tab-btn ${tab==='queue'?'active':''}`} onClick={()=>setTab('queue')}>Sıra{queue.length>0&&<span className="tab-count">{queue.length}</span>}</button>
        <button className={`tab-btn ${tab==='chat'?'active':''}`} onClick={()=>setTab('chat')}>Sohbet{messages.length>0&&<span className="tab-count">{messages.length}</span>}</button>
        <button className={`tab-btn ${tab==='history'?'active':''}`} onClick={()=>setTab('history')}>Geçmiş</button>
      </div>
      <div className="tab-content">
        {tab==='queue'&&<div className="tab-scroll"><div className="panel"><div className="panel-head"><div className="head-l"><h3>Sırada</h3><span className="count">·{queue.length}</span></div></div><QueuePanel items={queue} onRemove={onRemove} dense={dense}/></div><PlaylistPanel playlist={playlist} onAddAll={onAddAll} onRefresh={onRefresh} onPlayOne={onPlayOne}/></div>}
        {tab==='chat'&&<div className="tab-panel"><ChatPanel messages={messages} onSend={onSend} myId={myId}/></div>}
        {tab==='history'&&<div className="tab-scroll"><div className="panel"><div className="panel-head"><div className="head-l"><h3>Geçmiş</h3><span className="count">·{history.length}</span></div></div><HistoryPanel items={history}/></div></div>}
      </div>
    </aside>
  )
}

/* ── Dock ────────────────────────────────────────────── */
function Dock({onSubmit,onSearchToggle,searchOpen}) {
  const [url,setUrl]=useState(''), [err,setErr]=useState('')
  const submit=e=>{
    e?.preventDefault()
    const id=extractVideoId(url)
    if(!id){setErr('geçerli bir YouTube bağlantısı değil');setTimeout(()=>setErr(''),2500);return}
    onSubmit(id);setUrl('');setErr('')
  }
  return (
    <div className="dock">
      <form className="dock-inner" onSubmit={submit}>
        <button type="button" className={`dock-search-btn ${searchOpen?'active':''}`} onClick={onSearchToggle} title="YouTube'da ara"><Icon.Search/></button>
        <span className="dock-sep"/>
        <span className="dock-icon"><Icon.Link/></span>
        <input className="dock-input" placeholder="youtube.com/watch?v=…  ·  youtu.be/…" value={url} onChange={e=>{setUrl(e.target.value);if(err)setErr('')}} spellCheck={false}/>
        {err?<span className="dock-error">{err}</span>:<span className="dock-hint">enter</span>}
        <button className="btn-add" disabled={!url.trim()}><Icon.Plus/>Ekle</button>
      </form>
    </div>
  )
}

/* ── Main App (per-room) ─────────────────────────────── */
function App({room,onLeave}) {
  const [tweaks,setTweaks]=useTweaks(TWEAK_DEFAULTS)
  const [myName,setMyName]=useState(()=>getOrCreate('ify-name',randomSessionName))

  const [nowPlaying,setNowPlaying]=useState(null)
  const [queue,setQueue]=useState([])
  const [skipVotes,setSkipVotes]=useState(0)
  const [keepVotes,setKeepVotes]=useState(0)
  const [myVote,setMyVote]=useState(null)
  const [history,setHistory]=useState([])
  const [messages,setMessages]=useState([])
  const [listenersCount,setListenersCount]=useState(1)
  const [elapsed,setElapsed]=useState(0)
  const [duration,setDuration]=useState(0)
  const [playlist,setPlaylist]=useState(null)
  const [playlistSeed,setPlaylistSeed]=useState(0)
  const [toast,setToast]=useState(null)
  const [searchOpen,setSearchOpen]=useState(false)

  const nowPlayingRef=useRef(null)
  useEffect(()=>{nowPlayingRef.current=nowPlaying},[nowPlaying])

  useEffect(()=>{
    document.documentElement.style.setProperty('--accent',tweaks.accent)
    const hex=tweaks.accent.replace('#','')
    const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16)
    document.documentElement.style.setProperty('--accent-soft',`rgba(${r},${g},${b},0.14)`)
  },[tweaks.accent])

  useEffect(()=>{
    const unsubNP=onValue(ref(db,`rooms/${room}/nowPlaying`),snap=>{const np=snap.val();setNowPlaying(np);if(np)setElapsed(0)})
    const unsubQ=onValue(ref(db,`rooms/${room}/queue`),snap=>{const d=snap.val()||{};setQueue(Object.values(d).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)))})
    const unsubV=onValue(ref(db,`rooms/${room}/votes`),snap=>{const v=snap.val()||{};let s=0,k=0,my=null;Object.entries(v).forEach(([id,val])=>{if(id===MY_ID)my=val;if(val==='skip')s++;else if(val==='keep')k++});setSkipVotes(s);setKeepVotes(k);setMyVote(my)})
    const unsubH=onValue(query(ref(db,`rooms/${room}/history`),limitToLast(20)),snap=>{const d=snap.val()||{};setHistory(Object.values(d).sort((a,b)=>(b.playedAt||0)-(a.playedAt||0)))})
    const unsubC=onValue(query(ref(db,`rooms/${room}/chat`),limitToLast(100)),snap=>{const d=snap.val()||{};setMessages(Object.values(d).sort((a,b)=>(a.timestamp||0)-(b.timestamp||0)))})
    const unsubP=onValue(ref(db,`rooms/${room}/presence`),snap=>{setListenersCount(snap.val()?Object.keys(snap.val()).length:1)})
    return()=>{unsubNP();unsubQ();unsubV();unsubH();unsubC();unsubP()}
  },[room])

  useEffect(()=>{
    const presRef=ref(db,`rooms/${room}/presence/${MY_ID}`)
    const connRef=ref(db,'.info/connected')
    const unsub=onValue(connRef,snap=>{if(snap.val()){onDisconnect(presRef).remove();set(presRef,{name:myName,connectedAt:Date.now()})}})
    return()=>{unsub();remove(presRef)}
  },[room,myName])

  useEffect(()=>{
    const cutoff=Date.now()-24*60*60*1000
    get(ref(db,`rooms/${room}/chat`)).then(snap=>{
      if(!snap.val())return
      const u={}
      snap.forEach(c=>{if((c.val().timestamp||0)<cutoff)u[`rooms/${room}/chat/${c.key}`]=null})
      if(Object.keys(u).length)update(ref(db),u)
    })
  },[room])

  useEffect(()=>{if(history.length>=3){const p=generatePlaylist(history,playlistSeed);if(p)setPlaylist(p)}},[history.length])

  const started=!!nowPlaying
  const windowSec=tweaks.voteWindowSeconds??30
  const voteOpen=started&&elapsed<windowSec
  const verdictGuess=skipVotes>keepVotes?'skipped':'kept'

  useEffect(()=>{if(!started||voteOpen||!nowPlaying)return;if(skipVotes>keepVotes+1&&skipVotes>=3)advanceTrack('skipped')},[voteOpen])

  useEffect(()=>{
    const onKey=e=>{if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;if(e.key==='s'||e.key==='S')handleVote('skip');if(e.key==='d'||e.key==='D')handleVote('keep')}
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)
  },[])

  const showToast=useCallback((msg,kind='success')=>{setToast({msg,kind});setTimeout(()=>setToast(null),2500)},[])

  const advanceTrack=useCallback(async verdict=>{
    const currentId=nowPlayingRef.current?.id; if(!currentId)return
    const snap=await get(ref(db,`rooms/${room}`)); const r=snap.val()||{}
    if(!r.nowPlaying||r.nowPlaying.id!==currentId)return
    const u={}
    const hKey=push(ref(db,`rooms/${room}/history`)).key
    u[`rooms/${room}/history/${hKey}`]={...r.nowPlaying,verdict,playedAt:Date.now(),when:'az önce'}
    u[`rooms/${room}/votes`]=null
    const qe=Object.entries(r.queue||{}).sort(([,a],[,b])=>(a.createdAt||0)-(b.createdAt||0))
    if(qe.length>0){const[nk,nt]=qe[0];u[`rooms/${room}/nowPlaying`]={...nt,startedAt:Date.now()};u[`rooms/${room}/queue/${nk}`]=null}
    else u[`rooms/${room}/nowPlaying`]=null
    await update(ref(db),u)
  },[room])

  const handleVote=useCallback(async v=>{
    const vr=ref(db,`rooms/${room}/votes/${MY_ID}`)
    const snap=await get(vr)
    if(snap.val()===v)await remove(vr);else await set(vr,v)
  },[room])

  const submitUrl=useCallback(async videoId=>{
    const track={id:uid(),videoId,title:'yeni istek·oynatınca yüklenir',duration:0,requester:{name:myName,id:MY_ID},thumb:`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,source:'user',createdAt:Date.now()}
    const npSnap=await get(ref(db,`rooms/${room}/nowPlaying`))
    if(!npSnap.val())await set(ref(db,`rooms/${room}/nowPlaying`),{...track,startedAt:Date.now()})
    else await push(ref(db,`rooms/${room}/queue`),track)
    showToast('isteğin sıraya eklendi')
  },[room,myName,showToast])

  const removeFromQueue=useCallback(async trackId=>{
    const snap=await get(ref(db,`rooms/${room}/queue`)); if(!snap.val())return
    const u={}; snap.forEach(c=>{if(c.val().id===trackId)u[`rooms/${room}/queue/${c.key}`]=null})
    if(Object.keys(u).length)await update(ref(db),u)
  },[room])

  const sendMessage=useCallback(async text=>{
    await push(ref(db,`rooms/${room}/chat`),{userId:MY_ID,name:myName,text,timestamp:Date.now()})
  },[room,myName])

  const handleNameChange=useCallback(name=>{setMyName(name);lsSet('ify-name',name)},[])

  const addPlaylistAll=useCallback(async()=>{
    if(!playlist)return
    const now=Date.now(); const items=playlist.tracks.map((t,i)=>({...t,id:uid(),source:'auto',createdAt:now+i}))
    const npSnap=await get(ref(db,`rooms/${room}/nowPlaying`))
    if(!npSnap.val()){const[first,...rest]=items;await set(ref(db,`rooms/${room}/nowPlaying`),{...first,startedAt:Date.now()});for(const t of rest)await push(ref(db,`rooms/${room}/queue`),t)}
    else{for(const t of items)await push(ref(db,`rooms/${room}/queue`),t)}
    showToast(`${items.length} şarkı sıraya eklendi`)
  },[room,playlist,showToast])

  const refreshPlaylist=useCallback(()=>{const p=generatePlaylist(history,playlistSeed+1);if(p){setPlaylist(p);setPlaylistSeed(s=>s+1)}},[history,playlistSeed])

  const playOneFromPlaylist=useCallback(async t=>{
    const snap=await get(ref(db,`rooms/${room}/queue`)); const qd=snap.val()||{}
    const min=Object.values(qd).reduce((m,q)=>Math.min(m,q.createdAt||Date.now()),Date.now())
    await push(ref(db,`rooms/${room}/queue`),{...t,id:uid(),source:'auto',createdAt:min-1000})
    showToast('sıranın başına alındı')
  },[room,showToast])

  const closeRoom=useCallback(async()=>{
    await set(ref(db,`rooms/${room}/meta/closed`),true)
  },[room])

  const copyLink=useCallback(()=>{
    navigator.clipboard.writeText(window.location.href).then(()=>showToast('oda linki kopyalandı'))
  },[showToast])

  const progressPct=duration?Math.min(100,elapsed/duration*100):0
  const voteWindowPct=duration?Math.min(100,windowSec/duration*100):0

  return (
    <>
      <div className="backdrop"/><div className="bloom b1"/><div className="bloom b2"/><div className="bloom b3"/>
      {searchOpen&&<SearchPanel room={room} myName={myName} onClose={()=>setSearchOpen(false)} showToast={showToast}/>}
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">
              <span className="glyph"></span>
              <span className="wordmark">{'itemify'.split('').map((c,i)=><span key={i}>{c}</span>)}</span>
            </span>
            <span className="room-badge">{room}</span>
          </div>
          <div className="topbar-meta">
            <div className="listeners-block">
              <span className="live-pill"><span className="live-dot"></span><span className="num">{listenersCount}</span><span>dinleyici</span></span>
              <SessionName name={myName} onChange={handleNameChange}/>
            </div>
            <div className="topbar-actions">
              <button className="topbar-action" onClick={copyLink} title="Oda linkini kopyala"><Icon.Share/></button>
              <button className="topbar-action danger" onClick={closeRoom} title="Odayı kapat"><Icon.Power/></button>
            </div>
          </div>
        </header>

        <div className="grid">
          <div className="main-col">
            <PlayerStage
              started={started} videoId={nowPlaying?.videoId} startedAt={nowPlaying?.startedAt}
              onEnded={()=>{
                if(duration>0){const ps=(Date.now()-(nowPlaying?.startedAt||0))/1000;if(ps<duration*0.85)return}
                advanceTrack(verdictGuess)
              }}
              onTitle={t=>setNowPlaying(np=>np&&np.title!==t?{...np,title:t}:np)}
              onDuration={d=>{setDuration(d);setNowPlaying(np=>np?{...np,duration:d}:np)}}
              onTime={t=>setElapsed(t)}
            />
            {nowPlaying&&(
              <>
                <div className="nowplaying">
                  <div className="np-left"><h2 className="np-title">{nowPlaying.title}</h2></div>
                  <div className="np-timer"><span className="big">{fmtTime(elapsed)}</span><span>{fmtTime(duration||nowPlaying.duration)}</span></div>
                </div>
                <div className="progress">
                  <div className="fill" style={{transform:`scaleX(${progressPct/100})`}}/>
                  {voteWindowPct>0&&voteWindowPct<100&&<div className="window" style={{left:0,width:`${voteWindowPct}%`}}/>}
                </div>
                {voteOpen&&<VoteBar elapsed={elapsed} windowSec={windowSec} skipVotes={skipVotes} keepVotes={keepVotes} myVote={myVote} onVote={handleVote} totalListeners={listenersCount}/>}
                {!voteOpen&&<VoteClosed skipVotes={skipVotes} keepVotes={keepVotes} verdict={verdictGuess}/>}
              </>
            )}
            {!nowPlaying&&(
              <div style={{marginTop:22,padding:'32px 24px',border:'1px dashed rgba(255,255,255,0.12)',borderRadius:14,textAlign:'center',color:'var(--ink-3)'}}>
                kuyrukta şarkı yok — aşağıdan bir YouTube bağlantısı paylaş ya da arama yap
              </div>
            )}
          </div>

          <Sidebar queue={queue} messages={messages} history={history} playlist={playlist} onRemove={removeFromQueue} onAddAll={addPlaylistAll} onRefresh={refreshPlaylist} onPlayOne={playOneFromPlaylist} onSend={sendMessage} myId={MY_ID} dense={tweaks.denseQueue}/>
        </div>

        <Dock onSubmit={submitUrl} onSearchToggle={()=>setSearchOpen(o=>!o)} searchOpen={searchOpen}/>

        {toast&&<div className={`toast ${toast.kind||''}`}><span className="pip"></span><span>{toast.msg}</span></div>}

        <TweaksPanel title="Tweaks">
          <TweakSection label="Görünüm"><TweakColor label="Vurgu rengi" value={tweaks.accent} onChange={v=>setTweaks('accent',v)} options={ACCENT_OPTIONS}/></TweakSection>
          <TweakSection label="Oylama"><TweakSlider label="Oylama süresi" value={tweaks.voteWindowSeconds} onChange={v=>setTweaks('voteWindowSeconds',v)} min={10} max={60} step={5} unit=" sn"/></TweakSection>
          <TweakSection label="Otomatik derleme">
            <TweakSlider label="Her N şarkıda yenile" value={tweaks.autoPlaylistEvery} onChange={v=>setTweaks('autoPlaylistEvery',v)} min={2} max={10} step={1} unit=" şarkı"/>
            <TweakToggle label="Sıra biterse derlemeden devam et" value={tweaks.autoQueueWhenEmpty} onChange={v=>setTweaks('autoQueueWhenEmpty',v)}/>
          </TweakSection>
          <TweakSection label="Kuyruk"><TweakToggle label="Sıkı satır" value={tweaks.denseQueue} onChange={v=>setTweaks('denseQueue',v)}/></TweakSection>
        </TweaksPanel>
      </div>
    </>
  )
}

/* ── AppRouter (default export) ──────────────────────── */
export default function AppRouter() {
  const [room,setRoom]=useState(()=>{
    const hash=window.location.hash.slice(1).toUpperCase()
    return /^[A-Z0-9]{6}$/.test(hash)?hash:null
  })

  useEffect(()=>{
    const h=()=>{const hash=window.location.hash.slice(1).toUpperCase();setRoom(/^[A-Z0-9]{6}$/.test(hash)?hash:null)}
    window.addEventListener('hashchange',h);return()=>window.removeEventListener('hashchange',h)
  },[])

  useEffect(()=>{
    if(!room)return
    return onValue(ref(db,`rooms/${room}/meta/closed`),snap=>{
      if(snap.val()===true){window.location.hash='';setRoom(null)}
    })
  },[room])

  const joinRoom=useCallback(code=>{window.location.hash=code;setRoom(code)},[])

  const createRoom=useCallback(async()=>{
    const code=generateRoomCode()
    await set(ref(db,`rooms/${code}/meta`),{createdAt:Date.now(),creatorId:MY_ID,closed:false})
    window.location.hash=code; setRoom(code)
  },[])

  if(!room) return <Landing onJoin={joinRoom} onCreate={createRoom}/>
  return <App key={room} room={room} onLeave={()=>{window.location.hash='';setRoom(null)}}/>
}
