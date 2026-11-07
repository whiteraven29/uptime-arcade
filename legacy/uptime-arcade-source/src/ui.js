/* ========== game constants ========== */
const $=id=>document.getElementById(id);
const mmss=s=>{s=Math.max(0,Math.ceil(s));return pad(Math.floor(s/60))+":"+pad(s%60)};
const dayKey=(d=new Date())=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const KEY="uptime-arcade-v3",BANK_CAP=30*60,BONUS_CAP=60*60,STARTER=5*60,GOAL_BONUS=2,HINT_COST=15,PAR_BONUS=20,REW_XP=15,REW_FIRST=5;
const EARN={15:5,25:8,45:15};
const LEVELS=[[0,"Noob"],[5,"Initiate"],[12,"Apprentice"],[22,"Operator"],[34,"Adept"],[46,"Specialist"],[58,"Technomancer"],[70,"Sorcerer"],[85,"Sage"],[100,"Archmage"]];
const STREAKS=[[3,5,50,0],[7,10,150,1],[14,15,300,0],[21,15,500,1],[30,20,1000,0],[60,30,2000,1],[100,30,5000,1]];
const BADGES=[["firstblock","First Block","Finish a focus block",()=>S.blocks>=1],["clean10","Clean Ten","10 blocks with no drifts",()=>S.cleanBlocks>=10],["hours10","Ten Hours","10 hours of focus",()=>S.focusMin>=600],["hours100","Hundred Hours","100 hours of focus",()=>S.focusMin>=6000],["week","Full Week","7 day streak",()=>S.bestStreak>=7],["month","Iron Month","30 day streak",()=>S.bestStreak>=30],["first","First Clear","Clear one mission",()=>cleared()>=1],
 ...TRACKS.map(([k,l])=>["t"+k,l+" Master","Clear the "+l+" path",()=>TK[k].every(m=>S.rewDone[m.id])]),["arch","Archmage","Clear all 100 missions",()=>S.peak>=100]];
const fresh=()=>({v:3,updatedAt:0,xp:0,focusMin:0,blocks:0,cleanBlocks:0,streak:0,bestStreak:0,shields:0,lastDay:null,day:dayKey(),todayMin:0,todayDrifts:0,bank:STARTER,sessionEndsAt:null,focus:null,claim:null,len:25,
  cur:null,done:{},rew:{},rewDone:{},hints:{},cmds:{},tries:{},code:{},viKeys:{},overlay:{},cwd:HOME,hist:[],net:{gw:"10.40.3.1"},season:1,peak:0,ended:false,claimed:{},badges:{},oc:null,ocShift:0,ocStreak:0,ocBest:0,ocTotal:0,ranScript:false});
let S=fresh(),screen="deck";
const byId=id=>TICKETS.find(t=>t.id===id);
const T=()=>S.oc||byId(S.cur);
const solved=()=>Object.keys(S.done).length;
const cleared=()=>Object.keys(S.rewDone).length;
const levelIdx=()=>{const c=Math.max(cleared(),S.peak);let i=0;LEVELS.forEach((l,k)=>{if(c>=l[0])i=k});return i};
const level=()=>LEVELS[levelIdx()][1];
const sessionOn=()=>!!S.sessionEndsAt&&Date.now()<S.sessionEndsAt;
const mult=()=>1+Math.min(S.streak,10)*.05;
const gain=x=>{const v=Math.round(x*mult());S.xp+=v;return v};
const stateOf=m=>{if(S.rewDone[m.id])return"clear";if(S.done[m.id])return"rewind";const p=TK[m.track][m.pos-1];return!p||S.rewDone[p.id]?"open":"locked"};

/* ========== saving ========== */
let remote=null,saveTimer=null,saving=false,dirtyAgain=false;
function migrate(o){if(o&&o.v===3)return o;if(!o)return null;const n=fresh();for(const k of["xp","focusMin","blocks","streak","lastDay","bank"])if(o[k]!==undefined)n[k]=o[k];n.bestStreak=n.streak;return n}
function loadLocal(){try{for(const k of[KEY,"uptime-arcade-v2"]){const r=localStorage.getItem(k);if(r)return migrate(JSON.parse(r))}}catch{}return null}
function save(){S.updatedAt=Date.now();try{localStorage.setItem(KEY,JSON.stringify(S))}catch{}if(remote){clearTimeout(saveTimer);saveTimer=setTimeout(flush,1500)}}
async function flush(){if(saving){dirtyAgain=true;return}saving=true;try{await remote.set(JSON.parse(JSON.stringify(S)))}catch{}saving=false;if(dirtyAgain){dirtyAgain=false;flush()}}
function adopt(o){S={...fresh(),...o};rollDay();fs.reset(S.overlay);renderAll()}
async function connect(){if(!window.claude||!claude.use)return;try{const[db,user]=await Promise.all([claude.use("db"),claude.use("user")]);if(!db||!user)return;const id=await user.id();if(!id)return;
  const ref=db.collection("data/users/"+id).doc("save3");const snap=await ref.get();remote=ref;if(snap.exists){const d=snap.data();if((d.updatedAt||0)>S.updatedAt)adopt(JSON.parse(JSON.stringify(d)))}else if(S.updatedAt)flush()}catch{}}
function rollDay(){const d=dayKey();if(S.day!==d){S.day=d;S.todayMin=0;S.todayDrifts=0}}

/* ========== screens ========== */
const NAVS=["deck","focus","missions","rewards","system"];
function go(n){screen=n;document.querySelectorAll(".screen").forEach(s=>s.hidden=s.id!=="s-"+n);
  document.querySelectorAll(".nav [data-go]").forEach(b=>{const on=b.dataset.go===n||(!NAVS.includes(n)&&b.dataset.go==="missions");if(on)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
  renderAll();if(n==="play")focusWork();window.scrollTo(0,0)}
let toastT;function toast(t){const e=$("toast");e.textContent=t;e.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>e.hidden=true,3600)}
function el(p,tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;if(p)p.appendChild(e);return e}
function btn(p,text,cls,fn){const b=el(p,"button","btn "+(cls||""),text);b.type="button";b.addEventListener("click",fn);return b}

/* ========== terminal ========== */
const out=$("out");
function pr(t,c){if(t==="")return;const s=document.createElement("span");if(c)s.className=c;s.textContent=t.endsWith("\n")?t:t+"\n";out.appendChild(s);while(out.childNodes.length>1500)out.removeChild(out.firstChild);out.scrollTop=out.scrollHeight}
function termErr(t){pr(t,"e")}
const promptText=()=>{const p=S.cwd===HOME?"~":S.cwd.startsWith(HOME+"/")?"~"+S.cwd.slice(HOME.length):S.cwd;return`ops@${HOST}:${p}$`};
function echoCmd(l){const a=el(null,"span","pr",promptText()+" "),b=el(null,"span","cmd",l+"\n");out.append(a,b);out.scrollTop=out.scrollHeight}
const META=new Set(["help","man","clear","brief","hint","submit","status","exit"]);
const HELP=`Tools: ls cd pwd cat head tail wc grep sort uniq cut tr sed awk find
       mv cp rm mkdir touch tee seq xargs echo paste diff tac rev nl
       for and while loops, if, pipes, >, >>, bash scripts
       vi ip ping dig netplan
Game:  brief        show the mission again
       hint         reveal a hint (costs ${HINT_COST} XP)
       submit X     answer the mission
       man <tool>   short reference for a tool
       status       your level and session time
Keys:  Tab completes, Up and Down recall history, Ctrl+L clears.`;
function meta(a){const c=a[0],t=T();
  if(c==="help")return pr(HELP);
  if(c==="man"){const m=MAN[a[1]];return m?pr(m):termErr(`No entry for ${a[1]||"that"}. Try: ${Object.keys(MAN).join(" ")}`)}
  if(c==="clear"){out.textContent="";return}
  if(!t)return pr("Pick a mission from the Missions screen.","d");
  if(c==="brief")return pr(`${t.title}\n${t.brief}\nGoal: ${t.goal}`,"s");
  if(c==="hint")return showHint();
  if(c==="status")return pr(`${level()}, XP ${S.xp}. Cleared ${cleared()}/100. Session left ${mmss((S.sessionEndsAt-Date.now())/1000)}.`);
  if(c==="exit")return pr("Use the Leave button, or close the session in System.","d");
  if(c==="submit")return submit(a.slice(1).join(" "))}
function answersFor(t){if(t.kind==="py")return py.state==="failed"?[t.tests[0][1]]:null;return t.answer||null}
function submit(v){const t=T();if(S.done[t.id])return pr("Already solved.","d");const ans=answersFor(t);
  if(!ans)return pr(t.kind==="py"?"This mission is graded by Run tests.":"This mission completes itself when the goal is met.","d");
  if(!v)return termErr("Usage: submit <answer>");S.tries[t.id]=(S.tries[t.id]||0)+1;
  const n=s=>s.trim().replace(/\s+/g," ").replace(/'/g,'"').replace(/, /g,",").toLowerCase();
  if(ans.some(a=>n(a)===n(v)))return complete(t);pr("Not that one. Check your work and try again.","e");save()}
function showHint(){const t=T();const n=S.hints[t.id]||0;if(S.done[t.id])return;
  if(n>=t.hints.length)return pr("No more hints here. Read the lesson again or run man <tool>.","d");
  S.hints[t.id]=n+1;pr(`Hint ${n+1}: ${t.hints[n]}`,"s");renderSide();save()}
function complete(t){if(t.oc)return completeOc(t);if(S.done[t.id])return;const used=S.hints[t.id]||0;let bonus=0,note="";
  if(t.kind==="py"||(t.kind==="answer"&&t.track!=="SH")){const n=S.tries[t.id]||1;note=n<=1?"first try":`${n} tries`;if(n<=1)bonus=PAR_BONUS}
  else if(t.parKind==="keys"){const k=S.viKeys[t.file]||0;note=`${k} keys, par ${t.par}`;if(k<=t.par)bonus=PAR_BONUS}
  else{const c=S.cmds[t.id]||0;note=`${c} command${c===1?"":"s"}, par ${t.par}`;if(c<=t.par)bonus=PAR_BONUS}
  const xp=gain(Math.max(10,t.xp+bonus-used*HINT_COST));S.done[t.id]={xp,note,bonus,hints:used};checkBadges();save();showDebrief(t);renderTop()}
function showDebrief(t){const b=$("debriefBox"),d=S.done[t.id];b.textContent="";el(b,"p","label","Mission complete");el(b,"h2","big",t.title);
  el(b,"p","good",`+${d.xp} XP. ${d.note}${d.bonus?" (par bonus)":""}`);el(b,"p","",t.why);el(b,"pre","",t.sol);el(b,"p","small","On the job: "+t.job);
  el(b,"p","obj","Clear five rewind tasks on this mission to unlock the next one.");
  const r=el(b,"div","row");btn(r,"Start rewind","go",()=>{$("debrief").hidden=true;startRewind(t.id)});btn(r,"Later","",()=>{$("debrief").hidden=true;S.cur=null;go("missions")});$("debrief").hidden=false}
function autoCheck(){const t=T();if(t&&!S.done[t.id]&&t.check&&t.check())complete(t)}
function runCommand(line){const src=line.trim();if(!src)return;echoCmd(line);S.hist.push(src);if(S.hist.length>100)S.hist.shift();
  const toks=src.split(/\s+/);if(META.has(toks[0])){meta(toks);save();return}
  const t=T();if(t&&!S.done[t.id])S.cmds[t.id]=(S.cmds[t.id]||0)+1;
  const buf=[];sh.sink=buf;sh.errSink=null;try{runLine(src)}catch(x){termErr("sh: "+x.message)}sh.sink=null;pr(buf.join(""));
  if(VI.on)return;autoCheck();$("ps").textContent=promptText();save()}
function afterVi(){autoCheck();renderPlay();save();$("cmd").focus()}

/* ========== on-call ========== */
function startOncall(){if(cleared()<100)return;S.ocShift=0;S.oc=genOncall();S.cur=null;go("play");pr("Pager: shift started. Five incidents, 60 XP each, plus 100 XP when you clear the shift.","s");save()}
function completeOc(t){const first=(S.tries[t.id]||1)<=1;S.ocStreak=first?S.ocStreak+1:0;S.ocBest=Math.max(S.ocBest,S.ocStreak);S.ocTotal++;S.ocShift++;gain(t.xp);delete S.tries[t.id];delete S.hints[t.id];delete S.cmds[t.id];
  pr(`[ok] Incident resolved. First-try streak ${S.ocStreak}, best ${S.ocBest}.\nHow it works: ${t.why}`,"k");
  if(S.ocShift>=5){gain(100);S.oc=null;pr("Shift complete: +100 XP.","s");toast("Shift complete");go("missions")}else{S.oc=genOncall();renderPlay()}save()}

/* ========== rewind ========== */
let rwFb=null,rwPick=[],rwTasks=null,rwId=null;
function startRewind(id){rwId=id;rwTasks=rewindTasks(byId(id));S.rew[id]=S.rew[id]||{q:[0,1,2,3,4],ok:0,miss:{}};rwFb=null;rwPick=[];go("rewind")}
function answerRewind(val){const st=S.rew[rwId],i=st.q[0],t=rwTasks[i];let ok;
  if(t.type==="mc")ok=val===t.answer;else if(t.type==="order")ok=val.join("\n")===t.answer.join("\n");else ok=t.answer.some(a=>normA(a)===normA(val));
  if(ok){const x=gain(REW_XP+(st.miss[i]?0:REW_FIRST));st.q.shift();st.ok++;rwFb={ok:true,x}}else{st.miss[i]=1;st.q.push(st.q.shift());rwFb={ok:false,answer:t.type==="order"?t.answer.join("\n"):Array.isArray(t.answer)?t.answer[0]:t.answer}}
  rwPick=[];save();renderRewind()}
function afterRewindStep(){rwFb=null;if(!S.rew[rwId].q.length)return finishRewind();renderRewind()}
function finishRewind(){const m=byId(rwId),before=levelIdx();S.rewDone[rwId]=true;delete S.rew[rwId];S.peak=Math.max(S.peak,cleared());S.cur=null;checkBadges();save();
  const nx=TK[m.track][m.pos+1];go("missions");toast(nx?`Unlocked: ${nx.title}`:`${TRACKS.find(t=>t[0]===m.track)[1]} path complete`);
  if(levelIdx()!==before)showLevel(levelIdx());if(cleared()===100&&!S.ended){S.ended=true;save();showFinale()}}
function renderRewind(){const b=$("rewind");b.textContent="";if(!rwId)return;const m=byId(rwId),st=S.rew[rwId];if(!st)return;
  el(b,"p","label",`Rewind: ${m.title}`);const pp=el(b,"div","pips");for(let i=0;i<5;i++)el(pp,"i",i<st.ok?"on":"");
  if(rwFb){el(b,"h2","big "+(rwFb.ok?"good":"bad"),rwFb.ok?`Correct. +${rwFb.x} XP`:"Not quite");if(!rwFb.ok){el(b,"p","","The answer was:");el(b,"pre","",rwFb.answer);el(b,"p","small","This task comes back at the end, so you can get it right.")}
    btn(b,st.q.length?"Next task":"Finish rewind","go",afterRewindStep).id="rwNext";return}
  if(!sessionOn()){el(b,"p","","Rewind needs an open session.");const r=el(b,"div","row");if(S.bank>0&&!S.focus&&!S.claim)btn(r,`Open session (${mmss(S.bank)})`,"go",openSession);btn(r,"Go to Focus","",()=>go("focus"));return}
  const t=rwTasks[st.q[0]];el(b,"p","label",t.kicker);if(t.brief)el(b,"p","small",t.brief);el(b,"h2","big",t.q);if(t.show)el(b,"pre","",t.show);
  if(t.type==="mc"){const code=m.track!=="NET"&&t.kicker==="Which one fits?";t.options.forEach(o=>{const x=el(b,"button","opt"+(code?" code":""),o);x.type="button";x.addEventListener("click",()=>answerRewind(o))})}
  else if(t.type==="order"){el(b,"p","small","Click the lines in the right order.");const done=el(b,"div");rwPick.forEach((o,i)=>{const x=el(done,"button","tok good",`${i+1}. ${o}`);x.type="button";x.addEventListener("click",()=>{rwPick.splice(i,1);renderRewind()})});
    t.scrambled.filter(o=>!rwPick.includes(o)).forEach(o=>{const x=el(b,"button","tok",o);x.type="button";x.addEventListener("click",()=>{rwPick.push(o);if(rwPick.length===t.scrambled.length)answerRewind([...rwPick]);else renderRewind()})})}
  else{if(t.type==="memory")el(b,"p","small",`Starts with: ${t.start}`);const f=el(b,"form","stack");const i=el(f,"input");i.type="text";i.id="rwInput";i.autocomplete="off";i.spellcheck=false;i.style.fontFamily="var(--mono)";btn(f,"Check","go",()=>{}).type="submit";f.addEventListener("submit",e=>{e.preventDefault();if(i.value.trim())answerRewind(i.value)});setTimeout(()=>i.focus(),0)}}

/* ========== focus and session ========== */
function startBlock(){const g=$("goal").value.trim();if(!g||!$("phone").checked)return;ensureAudio();if(S.sessionEndsAt)closeSession(true);const now=Date.now();S.focus={goal:g,len:S.len,startedAt:now,endsAt:now+S.len*60000,drifts:0};$("goal").value="";$("phone").checked=false;$("startBlock").disabled=true;renderAll();save()}
function closeSession(q){if(!S.sessionEndsAt)return;S.bank=Math.min(BONUS_CAP,Math.round(Math.max(0,(S.sessionEndsAt-Date.now())/1000)));S.sessionEndsAt=null;if(VI.on){VI.on=false;viShow(false)}if(!q)toast("Session closed. Time banked.");renderAll();save()}
function openSession(){if(S.focus||S.claim||S.bank<=0)return;S.sessionEndsAt=Date.now()+S.bank*1000;S.bank=0;renderAll();save();if(screen==="play")focusWork()}
function focusWork(){const t=T();if(t&&t.kind==="py"&&py.state!=="failed")$("py").focus();else if(sessionOn())$("cmd").focus()}
function dayGap(a,b){const d=s=>{const[y,m,dd]=s.split("-").map(Number);return Date.UTC(y,m-1,dd)};return Math.round((d(b)-d(a))/864e5)}
function bumpStreak(){const d=dayKey();if(S.lastDay===d)return;const gap=S.lastDay?dayGap(S.lastDay,d):1;
  if(gap===1)S.streak++;else if(gap>1&&S.shields>=gap-1){S.shields-=gap-1;S.streak++;toast(`Streak shield used. ${gap-1} missed day${gap>2?"s":""} covered.`)}else S.streak=1;
  S.lastDay=d;S.bestStreak=Math.max(S.bestStreak,S.streak);
  for(const[n,mins,xp,sh2]of STREAKS)if(S.streak>=n&&!S.claimed[n]){S.claimed[n]=true;S.bank=Math.min(BONUS_CAP,S.bank+mins*60);S.xp+=xp;S.shields+=sh2;toast(`${n} day streak reward: +${mins} min, +${xp} XP${sh2?", +1 shield":""}`)}}
function finishClaim(done){const c=S.claim;if(!c)return;const earn=EARN[c.len]*60+(done?GOAL_BONUS*60:0);S.bank=Math.max(S.bank,Math.min(BANK_CAP,S.bank+earn));
  toast(`+${mmss(earn)} play time`);S.focusMin+=c.len;S.blocks++;S.todayMin+=c.len;if(!c.drifts)S.cleanBlocks++;bumpStreak();gain(c.len+(done?10:0));S.claim=null;checkBadges();renderAll();save()}
function checkBadges(){for(const[id,name,,test]of BADGES)if(!S.badges[id]&&test()){S.badges[id]=true;toast("Badge earned: "+name)}}
let audio=null;
function ensureAudio(){try{audio=audio||new (window.AudioContext||window.webkitAudioContext)();audio.resume()}catch{}}
function chime(){try{if(!audio)return;[660,880].forEach((f,i)=>{const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=f;g.gain.value=.08;o.connect(g).connect(audio.destination);const t=audio.currentTime+i*.22;o.start(t);o.stop(t+.18)})}catch{}}
function tick(){const now=Date.now();rollDay();
  if(S.focus){if(now>=S.focus.endsAt){S.claim={goal:S.focus.goal,len:S.focus.len,drifts:S.focus.drifts};S.focus=null;chime();go("focus");save()}else if(screen==="focus")renderClock()}
  if(S.sessionEndsAt){if(now>=S.sessionEndsAt){S.sessionEndsAt=null;S.bank=0;if(VI.on){VI.on=false;viShow(false)}toast("Session over. Finish a focus block to earn more.");renderAll();save()}else $("cTime").textContent=mmss((S.sessionEndsAt-now)/1000)}}
function renderClock(){const f=S.focus,left=(f.endsAt-Date.now())/1000;$("clock").textContent=mmss(left);const c=2*Math.PI*92;$("fRing").setAttribute("stroke-dasharray",`${c*(1-left/(f.len*60))} ${c}`)}

/* ========== overlays ========== */
function showLevel(i){const b=$("levelBox");b.textContent="";el(b,"p","label",`Level ${i+1} of ${LEVELS.length}`);el(b,"div","name",LEVELS[i][1]);el(b,"p","","You cleared "+cleared()+" missions.");if(LEVELS[i+1])el(b,"p","small",`Next: ${LEVELS[i+1][1]} at ${LEVELS[i+1][0]} missions.`);btn(b,"Continue","go",()=>$("levelup").hidden=true);$("levelup").hidden=false}
function showFinale(){const b=$("levelBox");b.textContent="";el(b,"p","label","All paths complete");el(b,"div","name","Archmage");el(b,"p","",`You rose from Noob to Archmage at Whiteraven with ${S.focusMin} minutes of real focus across ${S.blocks} blocks.`);el(b,"p","small","On-call shifts are unlocked on the Missions screen, and you can start a new season in System.");btn(b,"Continue","go",()=>$("levelup").hidden=true);$("levelup").hidden=false}

/* ========== rendering ========== */
const nextUp=()=>{let best=null;for(const[k]of TRACKS){const m=TK[k].find(x=>stateOf(x)==="rewind")||TK[k].find(x=>stateOf(x)==="open");if(m&&(!best||(stateOf(m)==="rewind"&&stateOf(best)!=="rewind")||(stateOf(m)===stateOf(best)&&m.pos<best.pos)))best=m}return best};
function renderTop(){$("cLevel").textContent=level();$("cXp").textContent=S.xp;$("cStreak").textContent=S.streak+"d";$("cTimeL").textContent=S.sessionEndsAt?"Session":"Play time";if(!S.sessionEndsAt)$("cTime").textContent=mmss(S.bank)}
function renderDeck(){const i=levelIdx(),c=Math.max(cleared(),S.peak),lo=LEVELS[i][0],hi=(LEVELS[i+1]||[100])[0],frac=hi===lo?1:(c-lo)/(hi-lo),C=2*Math.PI*150;
  $("coreRing").setAttribute("stroke-dasharray",`${C*Math.min(1,frac)} ${C}`);$("coreLv").textContent=`Level ${i+1}`;$("coreName").textContent=level();$("coreSub").textContent=LEVELS[i+1]?`${hi-c} missions to ${LEVELS[i+1][1]}`:"Top of the order";
  $("dStreak").textContent=S.streak;const nx=STREAKS.find(s=>!S.claimed[s[0]]);$("dStreakNext").textContent=(nx?`Next reward at ${nx[0]} days. `:"")+`XP +${Math.round((mult()-1)*100)}%. Shields ${S.shields}.`;
  $("dToday").textContent=S.todayMin+"m";$("dTodaySub").textContent=`${S.todayDrifts} drifts logged`;$("dTotal").textContent=Math.floor(S.focusMin/60)+"h "+pad(S.focusMin%60)+"m";$("dBlocks").textContent=`${S.blocks} blocks finished`;
  const n=$("dNext");n.textContent="";const m=nextUp();
  if(S.focus||S.claim){el(n,"p","",S.focus?"A focus block is running.":"Your block is finished.");btn(n,"Back to Focus","go",()=>go("focus"))}
  else if(S.bank<=0&&!sessionOn()){el(n,"p","","No play time banked. Finish a focus block to earn some.");btn(n,"Start a block","go",()=>go("focus"))}
  else if(m){el(n,"div","",m.title).style.fontWeight="600";el(n,"p","small",`${TRACKS.find(t=>t[0]===m.track)[1]}, mission ${m.pos+1}`);btn(n,stateOf(m)==="rewind"?"Continue rewind":"Open briefing","go",()=>enter(m))}
  else el(n,"p","","All paths cleared.");
  const t=$("dTracks");t.textContent="";for(const[k,l]of TRACKS){const d=TK[k].filter(x=>S.rewDone[x.id]).length,w=el(t,"div","track");el(w,"span","",l);el(w,"span","dim",`${d}/${TK[k].length}`);el(el(w,"div","meter"),"i").style.width=(d/TK[k].length*100)+"%"}}
function renderFocus(){const run=!!S.focus,claim=!!S.claim;$("fIdle").hidden=run||claim;$("fRun").hidden=!run;$("fClaim").hidden=!claim;
  document.querySelectorAll("[data-len]").forEach(b=>b.setAttribute("aria-pressed",String(+b.dataset.len===S.len)));$("earnNote").textContent=`${S.len} min earns ${EARN[S.len]}:00 of play, plus ${GOAL_BONUS}:00 if you finish your goal. Banked ${mmss(S.bank)} of 30:00.`;
  if(run){$("runGoal").textContent=S.focus.goal;renderClock()}if(claim)$("claimGoal").textContent=S.claim.goal}
function enter(m){const st=stateOf(m);if(st==="locked")return toast("Clear the mission before this one first");if(st==="rewind")return startRewind(m.id);S.oc=null;S.cur=m.id;go("briefing")}
function renderMissions(){const box=$("oncallBox");box.textContent="";if(cleared()>=100){const h=el(box,"div","hud");h.style.marginBottom="12px";el(h,"p","label","On-call unlocked");el(h,"p","small",`Endless random incidents. Resolved ${S.ocTotal}, best first-try streak ${S.ocBest}.`);btn(h,"Start shift","go",startOncall)}
  const w=$("tracks");w.textContent="";for(const[k,l,sub]of TRACKS){const c=el(w,"div","hud tcol");el(c,"h3","",l);el(c,"div","small",sub);const ch=CHAPTERS[k];
    TK[k].forEach((m,i)=>{const cp=ch.find(x=>x[1]===i);if(cp)el(c,"div","chap",cp[0]);const st=stateOf(m),b=el(c,"button","node "+st);b.type="button";el(b,"span","dot");const t=el(b,"span","");el(t,"span","t",m.title).style.display="block";if(st==="rewind")el(t,"small","",`Rewind ${(S.rew[m.id]||{ok:0}).ok}/5`);b.addEventListener("click",()=>enter(m));b.dataset.id=m.id})}}
function renderBriefing(){const b=$("briefing"),m=byId(S.cur);b.textContent="";if(!m)return;const st=stateOf(m);el(b,"p","label",`${TRACKS.find(t=>t[0]===m.track)[1]} ${m.pos+1} of ${TK[m.track].length}`);el(b,"h2","big",m.title);
  const meta2=el(b,"div","meta");[["From",m.from],["Worth",m.xp+" XP"],["Par",parText(m)]].forEach(([k,v])=>{const s=el(meta2,"span","",k+" ");el(s,"b","",v)});
  el(b,"p","label","Lesson");el(b,"p","",m.learn[0]);el(b,"pre","",m.learn[1]);
  if(st==="clear"){el(b,"p","label","Debrief");el(b,"p","",m.why);el(b,"pre","",m.sol);el(b,"p","small","On the job: "+m.job);btn(b,"Back to missions","",()=>go("missions"));return}
  el(b,"p","label","Your mission");el(b,"p","",m.brief);el(b,"p","obj",m.goal);const r=el(b,"div","row");btn(r,"Launch mission","go",()=>go("play")).id="launch";btn(r,"Back","",()=>go("missions"))}
const parText=t=>t.parKind==="keys"?`${t.par} keys`:t.track==="SH"||t.kind==="auto"?`${t.par} command${t.par>1?"s":""}`:"first try";
function renderSide(){const b=$("side"),t=T();b.textContent="";if(!t)return;el(b,"p","label",t.oc?`On-call ${S.ocShift+1} of 5`:TRACKS.find(x=>x[0]===t.track)[1]);el(b,"h3","",t.title);
  const fb=t.kind==="py"&&py.state==="failed";el(b,"p","",fb?`The Python runner is blocked in this view, so read this code and work out what ${t.tests[0][0]} returns. The offline file always runs Python.`:t.brief);
  if(fb)el(b,"pre","",t.sol);else if(t.code)el(b,"pre","",t.code);el(b,"p","obj",fb?"Run: submit <the value, written as Python>":t.goal);
  for(let i=0;i<(S.hints[t.id]||0);i++)el(b,"p","hint-line",`Hint ${i+1}: ${t.hints[i]}`);
  if(t.learn){el(b,"p","label","Lesson");el(b,"p","small",t.learn[0]);el(b,"pre","",t.learn[1])}
  const r=el(b,"div","row");btn(r,`Hint (-${HINT_COST} XP)`,"",showHint);btn(r,"Help","",()=>{if(sessionOn())runCommand("help")});if(!t.oc)btn(r,"Leave","",()=>{S.cur=null;go("missions")})}
function renderPlay(){const on=sessionOn(),t=T();if(!t)return;if(t.kind==="py"&&py.state==="idle")py.load();const pyMode=t.kind==="py"&&py.state!=="failed";
  $("pyPane").hidden=!pyMode;$("out").hidden=pyMode;$("promptForm").hidden=!on||pyMode;$("lock").hidden=on;$("ps").textContent=promptText();
  if(pyMode){const ta=$("py"),want=S.code[t.id]??t.starter;if(ta.dataset.ticket!==t.id){ta.value=want;ta.dataset.ticket=t.id;$("pyOut").textContent=""}ta.readOnly=!on;$("pyRun").disabled=!on||py.state!=="ready";$("pyNote").textContent=py.state==="loading"?"Loading Python...":!on?"Open a session to run code.":"Tests run on your PC."}
  $("openSession").hidden=S.bank<=0||!!S.focus||!!S.claim;$("openSession").textContent=`Open session (${mmss(S.bank)})`;$("lockMsg").textContent=S.focus?"Locked while your focus block runs.":S.claim?"Answer the question on the Focus screen.":S.bank>0?"Session closed.":"No play time left. Finish a focus block to earn more.";renderSide();out.scrollTop=out.scrollHeight}
function renderRewards(){const b=$("rewards");b.textContent="";const a=el(b,"div","hud");el(a,"p","label","Day streak rewards");el(a,"p","small",`Finish one focus block a day to keep the streak. Best ${S.bestStreak} days. Shields ${S.shields}. XP bonus +${Math.round((mult()-1)*100)}%, up to +50%.`);const l=el(a,"div","lad"),nx=STREAKS.find(s=>!S.claimed[s[0]]);
  for(const[n,m,x,sh2]of STREAKS){const got=S.claimed[n],c=got?"on":nx&&nx[0]===n?"next":"";el(l,"span",c,`${n} days`);el(l,"span",c,`+${m} min play, +${x} XP${sh2?", +1 shield":""}`);el(l,"span",c,got?"Claimed":"")}
  const c=el(b,"div","hud");el(c,"p","label","Levels");const k=el(c,"div","lad"),cur=levelIdx();LEVELS.forEach((v,i)=>{const cl=i<cur?"on":i===cur?"next":"";el(k,"span",cl,String(i+1));el(k,"span",cl,v[1]);el(k,"span",cl,`${v[0]} missions`)});
  const d=el(b,"div","hud");d.style.gridColumn="1/-1";el(d,"p","label",`Badges ${Object.keys(S.badges).length}/${BADGES.length}`);const g=el(d,"div","badges");for(const[id,name,desc]of BADGES){const x=el(g,"div","badge"+(S.badges[id]?" got":""));el(x,"b","",name);x.append(desc)}}
function renderAll(){renderTop();if(screen==="deck")renderDeck();if(screen==="focus")renderFocus();if(screen==="missions")renderMissions();if(screen==="briefing")renderBriefing();if(screen==="play")renderPlay();if(screen==="rewind")renderRewind();if(screen==="rewards")renderRewards()}

/* ========== events ========== */
async function runPy(){const t=T();const src=$("py").value;S.code[t.id]=src;$("pyOut").textContent="Running...";if(!S.done[t.id])S.tries[t.id]=(S.tries[t.id]||0)+1;
  const tests=t.tests.map(x=>`_t(${JSON.stringify(x[0])}, ${x[0]}, ${x[1]})`).join("\n");const r=await py.exec(src+"\n"+HARNESS+tests+'\nprint("ALL_PASSED" if _fails == 0 else "SOME_FAILED")\n');
  const passed=r.ok&&/ALL_PASSED/.test(r.out);$("pyOut").textContent=r.out.replace(/ALL_PASSED|SOME_FAILED/,"").trim();if(passed)complete(t);save()}
const hist={i:null};
$("promptForm").addEventListener("submit",e=>{e.preventDefault();const c=$("cmd"),v=c.value;c.value="";hist.i=null;if(!sessionOn())return;runCommand(v);c.focus()});
$("cmd").addEventListener("keydown",e=>{const c=e.target;if(e.key==="Tab"){e.preventDefault();complete2(c)}else if(e.key==="ArrowUp"){e.preventDefault();if(hist.i===null)hist.i=S.hist.length;hist.i=Math.max(0,hist.i-1);c.value=S.hist[hist.i]||""}else if(e.key==="ArrowDown"){e.preventDefault();if(hist.i===null)return;hist.i++;if(hist.i>=S.hist.length){hist.i=null;c.value=""}else c.value=S.hist[hist.i]}else if(e.ctrlKey&&e.key==="l"){e.preventDefault();out.textContent=""}else if(e.ctrlKey&&e.key==="c"){e.preventDefault();echoCmd(c.value+"^C");c.value=""}});
$("py").addEventListener("keydown",e=>{if(e.key==="Tab"){e.preventDefault();const t=e.target;t.setRangeText("    ",t.selectionStart,t.selectionEnd,"end")}});
$("py").addEventListener("input",()=>{const t=T();if(t){S.code[t.id]=$("py").value;save()}});
$("pyRun").addEventListener("click",()=>{if(sessionOn())runPy()});
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.go)));
const syncStart=()=>{$("startBlock").disabled=!($("goal").value.trim()&&$("phone").checked)};
$("goal").addEventListener("input",syncStart);$("phone").addEventListener("change",syncStart);
document.querySelectorAll("[data-len]").forEach(b=>b.addEventListener("click",()=>{S.len=+b.dataset.len;renderFocus();save()}));
$("startBlock").addEventListener("click",startBlock);
$("drift").addEventListener("click",()=>{if(!S.focus)return;S.focus.drifts++;S.todayDrifts++;$("driftMsg").textContent=`Logged. Back to it: ${S.focus.goal}`;save()});
$("quit").addEventListener("click",()=>$("quitAsk").hidden=false);$("quitNo").addEventListener("click",()=>$("quitAsk").hidden=true);
$("quitYes").addEventListener("click",()=>{S.focus=null;$("quitAsk").hidden=true;toast("Block ended early. Nothing earned.");renderAll();save()});
$("claimYes").addEventListener("click",()=>finishClaim(true));$("claimNo").addEventListener("click",()=>finishClaim(false));
$("openSession").addEventListener("click",openSession);$("closeSession").addEventListener("click",()=>closeSession());
$("reset").addEventListener("click",()=>$("resetAsk").hidden=false);$("resetNo").addEventListener("click",()=>$("resetAsk").hidden=true);
$("resetYes").addEventListener("click",()=>{Object.assign(S,{cur:null,done:{},rew:{},rewDone:{},hints:{},cmds:{},tries:{},code:{},viKeys:{},overlay:{},cwd:HOME,net:{gw:"10.40.3.1"},oc:null,ended:false,ranScript:false,season:S.season+1});fs.reset({});$("resetAsk").hidden=true;$("py").dataset.ticket="";toast(`Season ${S.season} started`);save();go("missions")});
async function exportSave(){const name=`uptime-arcade-save-${dayKey()}.json`,data=JSON.stringify(S);try{const d=window.claude&&claude.use?await claude.use("downloads"):null;if(d){await d.save({filename:name,data});$("sysMsg").textContent="Save backed up.";return}const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([data],{type:"application/json"}));a.download=name;document.body.appendChild(a);a.click();a.remove();$("sysMsg").textContent="Saved as "+name}catch{$("sysMsg").textContent="Backup didn't finish. Try again."}}
$("exportSave").addEventListener("click",exportSave);$("importSave").addEventListener("click",()=>$("importFile").click());
$("importFile").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;try{const o=migrate(JSON.parse(await f.text()));if(!o||typeof o.xp!=="number")throw 0;o.sessionEndsAt=null;adopt(o);save();$("sysMsg").textContent="Save loaded."}catch{$("sysMsg").textContent="That file isn't an Uptime Arcade save."}e.target.value=""});

