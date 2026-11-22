import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useGame } from '../api/useGame.js';
import { S, closeSession, level, mmss, refreshPlayer, setNavigator, tick, ui } from '../api/game.js';
import { ensureAudio } from '../sound/cues.js';
import { SceneBackdrop } from '../ui/SceneBackdrop.jsx';
import { Toast } from '../ui/Toast.jsx';
import { CollapseIcon, DeckIcon, FocusIcon, Logo, MissionsIcon, ProfileIcon, RewardsIcon, SystemIcon } from '../ui/icons.jsx';
import { Avatar } from '../ui/Avatar.jsx';
import { Overlays } from './Overlays.jsx';
import { DeckScreen } from '../features/deck/DeckScreen.jsx';
import { FocusScreen } from '../features/focus/FocusScreen.jsx';
import { MissionsScreen } from '../features/missions/MissionsScreen.jsx';
import { BriefingScreen } from '../features/briefing/BriefingScreen.jsx';
import { PlayScreen } from '../features/play/PlayScreen.jsx';
import { RewindScreen } from '../features/rewind/RewindScreen.jsx';
import { OnCallScreen } from '../features/oncall/OnCallScreen.jsx';
import { RewardsScreen } from '../features/rewards/RewardsScreen.jsx';
import { ProfileScreen } from '../features/profile/ProfileScreen.jsx';
import { SandboxScreen } from '../features/netlab/SandboxScreen.jsx';
import { SystemScreen } from '../features/system/SystemScreen.jsx';
import { AuthScreen } from '../features/auth/AuthScreen.jsx';

const NAV = [
  ['/', 'Deck', DeckIcon],
  ['/focus', 'Focus', FocusIcon],
  ['/missions', 'Missions', MissionsIcon],
  ['/rewards', 'Rewards', RewardsIcon],
  ['/profile', 'Profile', ProfileIcon],
  ['/system', 'System', SystemIcon],
];
const TITLES = { '': 'Deck', focus: 'Focus', missions: 'Missions', rewards: 'Rewards', profile: 'Profile', system: 'System', sandbox: 'NetLab sandbox', oncall: 'On call' };

/* Full or folded to icons. Your choice is remembered on this device. Until you make one, the window decides:
   full when there's room, icons when there isn't. */
const SIDE_KEY = 'ua_side';
const NARROW = '(max-width: 1279px)';
function readSide() {
  try {
    return localStorage.getItem(SIDE_KEY);
  } catch {
    return null;
  }
}
function useSidebar() {
  const [chosen, setChosen] = useState(readSide);
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(NARROW);
    if (!query) return undefined;
    const follow = () => setNarrow(query.matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);
  const folded = chosen ? chosen === 'rail' : narrow;
  const toggle = () => {
    const next = folded ? 'full' : 'rail';
    setChosen(next);
    try {
      localStorage.setItem(SIDE_KEY, next);
    } catch { /* remembered for this visit only */ }
  };
  return [folded, toggle];
}

/* The screens, down the left like a dashboard (ADR 0019). It folds to icons, and on a phone it becomes a bar
   along the bottom, where a thumb can reach it. */
function SideBar({ folded, onToggle }) {
  return (
    <aside className="sidebar">
      <div className="side-head">
        <Link className="logo" to="/"><Logo /><span className="logo-text">WHITERAVEN</span></Link>
        <button className="side-toggle" type="button" id="sideToggle" aria-expanded={!folded} aria-label={folded ? 'Expand the sidebar' : 'Collapse the sidebar'} title={folded ? 'Expand' : 'Collapse'} onClick={onToggle}>
          <CollapseIcon />
        </button>
      </div>
      <nav className="nav" aria-label="Screens">
        {NAV.map(([to, label, Icon]) => (
          <NavLink key={to} to={to} end={to === '/'} title={label}><Icon /><span className="nav-label">{label}</span></NavLink>
        ))}
      </nav>
    </aside>
  );
}

/* Where you are, and your numbers: always in view, whatever the screen. */
function TopBar({ pathname }) {
  const running = !!S.sessionEndsAt;
  const clock = running ? mmss((S.sessionEndsAt - Date.now()) / 1000) : mmss(S.bank);
  return (
    <header className="top">
      <Link className="logo top-logo" to="/" aria-label="Whiteraven, the Deck"><Logo /></Link>
      <p className="top-title">{TITLES[pathname.split('/')[1]] ?? ''}</p>
      <div className="chips">
        <span className="chip"><b>{level()}</b></span>
        <span className="chip">XP <b>{S.xp}</b></span>
        <span className="chip">Streak <b>{S.streak}d</b></span>
        <span className="chip-time">
          {running ? 'Session' : 'Play time'} <b>{clock}</b>
          {running && <button className="chip-stop" type="button" id="stopSession" aria-label="Stop the session and bank the time" title="Stop the session and bank the time" onClick={() => closeSession()}>Stop</button>}
        </span>
        <Link className="me" to="/profile" title="Your profile">
          <Avatar avatar={ui.account?.avatar} name={ui.account?.username} size={32} />
          <b id="meName">{ui.account?.username}</b>
        </Link>
      </div>
    </header>
  );
}

export function App() {
  useGame();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const frame = useRef(null);
  const [folded, toggleSide] = useSidebar();

  useEffect(() => {
    setNavigator(navigate);
  }, [navigate]);
  useEffect(() => {
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  // Section 5: when a focus block finishes, every screen sends you to Focus to claim it.
  useEffect(() => {
    if (ui.auth === 'in' && S.claim && pathname !== '/focus') navigate('/focus');
  }, [pathname, navigate]);
  // Coming back to this tab picks up whatever another tab or device did.
  useEffect(() => {
    const onVisible = () => {
      if (ui.auth === 'in' && !document.hidden) refreshPlayer().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return (
    <div onPointerDown={ensureAudio}>
      <div className="frame" ref={frame} data-side={folded ? 'rail' : 'full'} data-screen={ui.auth !== 'in' ? 'auth' : pathname === '/' ? 'deck' : 'other'}>
        <SceneBackdrop frameRef={frame} />
        <div className="scene-veil" />
        <div className="frame-scan" />
        <div className="frame-edge" />
        {ui.auth === 'in' && <SideBar folded={folded} onToggle={toggleSide} />}
        {ui.auth === 'in' && <TopBar pathname={pathname} />}
        {ui.auth === 'checking' && <main><p className="splash">Connecting...</p></main>}
        {ui.auth === 'out' && (
          <main>
            <Routes>
              <Route path="/register" element={<AuthScreen />} />
              <Route path="/login" element={<AuthScreen />} />
              <Route path="/verify" element={<AuthScreen />} />
              <Route path="/forgot" element={<AuthScreen />} />
              <Route path="/reset" element={<AuthScreen />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </main>
        )}
        {ui.auth === 'in' && <main>
          <Routes>
            <Route path="/" element={<DeckScreen />} />
            <Route path="/focus" element={<FocusScreen />} />
            <Route path="/missions" element={<MissionsScreen />} />
            <Route path="/missions/:slug" element={<BriefingScreen />} />
            <Route path="/missions/:slug/play" element={<PlayScreen />} />
            <Route path="/missions/:slug/rewind" element={<RewindScreen />} />
            <Route path="/ops" element={<Navigate to="/missions" replace />} />
            <Route path="/oncall" element={<OnCallScreen />} />
            <Route path="/rewards" element={<RewardsScreen />} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="/sandbox" element={<SandboxScreen />} />
            <Route path="/system" element={<SystemScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>}
      </div>
      {ui.auth === 'in' && <Overlays />}
      <Toast text={ui.toast} badge={ui.toastBadge} />
    </div>
  );
}
