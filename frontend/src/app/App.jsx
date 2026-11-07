import { useEffect, useRef } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useGame } from '../api/useGame.js';
import { S, level, mmss, refreshPlayer, setNavigator, tick, ui } from '../api/game.js';
import { ensureAudio } from '../sound/cues.js';
import { SceneBackdrop } from '../ui/SceneBackdrop.jsx';
import { Toast } from '../ui/Toast.jsx';
import { Logo } from '../ui/icons.jsx';
import { Avatar } from '../ui/Avatar.jsx';
import { Overlays } from './Overlays.jsx';
import { DeckScreen } from '../features/deck/DeckScreen.jsx';
import { FocusScreen } from '../features/focus/FocusScreen.jsx';
import { MissionsScreen } from '../features/missions/MissionsScreen.jsx';
import { BriefingScreen } from '../features/briefing/BriefingScreen.jsx';
import { PlayScreen } from '../features/play/PlayScreen.jsx';
import { RewindScreen } from '../features/rewind/RewindScreen.jsx';
import { OpsScreen } from '../features/ops/OpsScreen.jsx';
import { OnCallScreen } from '../features/oncall/OnCallScreen.jsx';
import { RewardsScreen } from '../features/rewards/RewardsScreen.jsx';
import { ProfileScreen } from '../features/profile/ProfileScreen.jsx';
import { SystemScreen } from '../features/system/SystemScreen.jsx';
import { AuthScreen } from '../features/auth/AuthScreen.jsx';

const NAV = [['/', 'Deck'], ['/focus', 'Focus'], ['/missions', 'Missions'], ['/rewards', 'Rewards'], ['/system', 'System']];

function TopBar() {
  const running = !!S.sessionEndsAt;
  const clock = running ? mmss((S.sessionEndsAt - Date.now()) / 1000) : mmss(S.bank);
  return (
    <header className="top">
      <Link className="logo" to="/"><Logo />WHITERAVEN</Link>
      <nav className="nav" aria-label="Screens">
        {NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}
      </nav>
      <div className="chips">
        <span className="chip"><b>{level()}</b></span>
        <span className="chip">XP <b>{S.xp}</b></span>
        <span className="chip">Streak <b>{S.streak}d</b></span>
        <span className="chip-time">{running ? 'Session' : 'Play time'} <b>{clock}</b></span>
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
      <div className="frame" ref={frame} data-screen={ui.auth !== 'in' ? 'auth' : pathname === '/' ? 'deck' : 'other'}>
        <SceneBackdrop frameRef={frame} />
        <div className="scene-veil" />
        <div className="frame-scan" />
        <div className="frame-edge" />
        {ui.auth === 'in' && <TopBar />}
        {ui.auth === 'checking' && <main><p className="splash">Connecting...</p></main>}
        {ui.auth === 'out' && (
          <main>
            <Routes>
              <Route path="/register" element={<AuthScreen />} />
              <Route path="/login" element={<AuthScreen />} />
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
            <Route path="/ops" element={<OpsScreen />} />
            <Route path="/oncall" element={<OnCallScreen />} />
            <Route path="/rewards" element={<RewardsScreen />} />
            <Route path="/profile" element={<ProfileScreen />} />
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
