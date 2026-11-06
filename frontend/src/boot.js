/* ========== boot ========== */
const savedGame=loadLocal();if(savedGame)S={...fresh(),...savedGame};
rollDay();fs.reset(S.overlay);
pr(`Whiteraven operator console. Your account is 'ops'.\nRun 'help' for the tools on this box.\n`,"d");
go("deck");tick();setInterval(tick,1000);connect();
