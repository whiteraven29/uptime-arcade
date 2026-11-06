/* ========== tab completion ========== */
function complete2(input){const v=input.value,cur=input.selectionStart;const before=v.slice(0,cur);const m=/(?:^|[\s|;&])((?:\\ |[^\s|;&])*)$/.exec(before);const word=(m?m[1]:"").replace(/\\ /g," ");
  const first=!before.slice(0,before.length-word.length).trim();let c=[];
  if(first&&!word.includes("/"))c=[...Object.keys(COMMANDS),...META].filter(x=>x.startsWith(word)).sort();
  else{const sl=word.lastIndexOf("/"),dirS=sl>=0?word.slice(0,sl+1):"",part=word.slice(sl+1),dir=norm((dirS.startsWith("~")?HOME+dirS.slice(1):dirS)||".");
    const k=fs.kids(dir).filter(p=>p.slice(p.lastIndexOf("/")+1).startsWith(part)&&(part.startsWith(".")||!p.slice(p.lastIndexOf("/")+1).startsWith(".")));
    c=k.map(p=>dirS+p.slice(p.lastIndexOf("/")+1)+(fs.get(p).t==="d"?"/":""))}
  if(!c.length)return;
  const esc=s=>s.replace(/ /g,"\\ ");const rep=x=>{const raw=before.slice(0,before.length-(m?m[1].length:0))+x;input.value=raw+v.slice(cur);input.selectionStart=input.selectionEnd=raw.length};
  if(c.length===1)return rep(esc(c[0])+(c[0].endsWith("/")?"":" "));
  let p=c[0];for(const x of c)while(!x.startsWith(p))p=p.slice(0,-1);
  if(p.length>word.length)rep(esc(p));else{echoCmd(v);pr(c.map(x=>x.slice(x.lastIndexOf("/",x.length-2)+1)).join("  "),"d")}}

/* ========== vi view ========== */
function viShow(on){$("vi").hidden=!on;if(on){viRender();$("vi").focus()}}
function viRender(){const box=$("viText"),rows=Math.max(8,Math.floor((box.clientHeight-20)/19));
  if(VI.r<VI.top)VI.top=VI.r;if(VI.r>=VI.top+rows)VI.top=VI.r-rows+1;
  box.textContent="";
  for(let i=VI.top;i<VI.top+rows;i++){
    if(i>=VI.L.length){const s=document.createElement("span");s.className="tilde";s.textContent="~\n";box.appendChild(s);continue}
    const l=VI.L[i];
    if(i===VI.r&&VI.mode!=="command"){const c=Math.min(VI.c,l.length);box.append(l.slice(0,c));const s=document.createElement("span");s.className="cur";s.textContent=l[c]||" ";box.append(s,l.slice(c+1)+"\n")}else box.append(l+"\n")}
  $("viMsg").textContent=VI.mode==="command"?VI.cmd:VI.mode==="insert"?"-- INSERT --":(VI.msg||VI.shown);
  $("viKeys").textContent=`${VI.r+1},${VI.c+1}   keys ${VI.keys}`}
$("vi").addEventListener("keydown",e=>{if(!VI.on)return;e.preventDefault();e.stopPropagation();viKey(e.key,e.ctrlKey);if(VI.on)viRender()});

/* ========== python runner (Skulpt, loaded on first use) ========== */
const py={state:"idle",load(){if(this.p)return this.p;this.state="loading";
  const add=src=>new Promise((res,rej)=>{const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s)});
  const base2="https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/";
  const loaded=window.Sk&&window.Sk.builtinFiles?Promise.resolve():add(base2+"skulpt.min.js").then(()=>add(base2+"skulpt-stdlib.js"));const go=loaded.then(()=>this.exec("print(6*7)")).then(r=>{if(r.out.trim()!=="42")throw new Error("smoke failed");this.state="ready"});
  const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),12000));
  this.p=Promise.race([go,timeout]).catch(()=>{this.state="failed"}).then(()=>{renderAll()});return this.p},
 exec(src){const o=[];Sk.configure({output:t=>o.push(t),read:f=>{if(Sk.builtinFiles===undefined||Sk.builtinFiles.files[f]===undefined)throw new Error("File not found: "+f);return Sk.builtinFiles.files[f]},__future__:Sk.python3,execLimit:4000});
  return Sk.misceval.asyncToPromise(()=>Sk.importMainWithBody("<stdin>",false,src,true)).then(()=>({out:o.join(""),ok:true}),e=>({out:o.join("")+"\n"+e.toString(),ok:false}))}};
const HARNESS=`
_fails = 0
def _t(name, got, want):
    global _fails
    if got == want and type(got) == type(want):
        print("ok   " + name)
    else:
        _fails = _fails + 1
        print("FAIL " + name + ": got " + repr(got) + ", wanted " + repr(want))
`;
const toIp=n=>[n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join(".");
function genOncall(){const r=rng(Date.now()^(S.ocTotal*7919)),n=k=>Math.floor(r()*k),pick=a=>a[n(a.length)];
  const id="oc-"+Date.now()+"-"+n(1e6),base={id,oc:true,kind:"answer",par:1,from:"Pager",xp:60,goal:"Run: submit <answer>",hints:["Work it out step by step.","Check your maths once more before submitting."]};
  const p=20+n(10),ip=(10*2**24+n(2**24))>>>0,size=2**(32-p),net=Math.floor(ip/size)*size,ipS=toIp(ip)+"/"+p;
  const lvl=pick(["hosts","net","bcast","mask","log5","logpath","logslow","go","py"]);
  if(lvl==="hosts")return{...base,track:"NET",title:"Capacity check",brief:`How many usable hosts does a /${p} have?`,answer:[String(size-2)],why:"Usable hosts are 2^(32-prefix) minus 2.",sol:"submit "+(size-2),v:`str(2**(32-${p})-2)`};
  if(lvl==="net")return{...base,track:"NET",title:"Find the network",brief:`What is the network address of ${ipS}?`,answer:[toIp(net)],why:`The block size is ${size}, and networks start at its multiples.`,sol:"submit "+toIp(net),v:`str(ipaddress.ip_interface('${ipS}').network.network_address)`};
  if(lvl==="bcast")return{...base,track:"NET",title:"Find the broadcast",brief:`What is the broadcast address of ${ipS}?`,answer:[toIp(net+size-1)],why:"Broadcast is the network address plus the block size minus one.",sol:"submit "+toIp(net+size-1),v:`str(ipaddress.ip_interface('${ipS}').network.broadcast_address)`};
  if(lvl==="mask"){const m=(2**32-size)>>>0;return{...base,track:"NET",title:"Write the mask",brief:`Write the dotted subnet mask for /${p}.`,answer:[toIp(m)],why:"The mask has prefix-many one bits.",sol:"submit "+toIp(m),v:`str(ipaddress.ip_network('0.0.0.0/${p}').netmask)`}}
  if(lvl==="go"){const a=2+n(7),b=2+n(7),c=1+n(5);const out=[];for(let i=c;i<c+a;i++)out.push(i*b);const sum=out.reduce((x,y)=>x+y,0);
    return{...base,track:"GO",title:"Trace this loop",brief:"Predict what this Go code prints.",code:`s := 0\nfor i := ${c}; i < ${c+a}; i++ {\n\ts += i * ${b}\n}\nfmt.Println(s, ${c+a}-${c})`,answer:[`${sum} ${a}`],why:"Trace the loop one step at a time.",sol:`submit ${sum} ${a}`}}
  if(lvl==="py"){const L=Array.from({length:4+n(4)},()=>1+n(30)),k=2+n(3);const v=L.filter(x=>x%k===0);const ans2=v.reduce((x,y)=>x+y,0);
    return{...base,track:"PY",title:"Read this filter",brief:"Predict what this Python code prints.",code:`v = [${L.join(", ")}]\nprint(sum(x for x in v if x % ${k} == 0))`,answer:[String(ans2)],why:"The generator keeps multiples, and sum adds them.",sol:"submit "+ans2,pyv:`v = [${L.join(", ")}]\nprint(sum(x for x in v if x % ${k} == 0))`}}
  const paths=["/v1/orders","/v1/users","/v1/search","/v1/upload","/health"],rows=[];
  for(let i=0;i<300;i++)rows.push([pick(paths),r()<.1?500:200,10+n(4000)]);
  const log=joinL(rows.map(x=>x.join(" ")));writeFile(HOME+"/oncall/shift.log",log,"oncall");
  const bl={...base,track:"SH",hints:["Columns: path status ms.","awk, sort and uniq -c are enough."],goal:"Use ~/oncall/shift.log, then run: submit <answer>"};
  if(lvl==="log5")return{...bl,title:"Error spike",brief:"How many requests returned 500?",answer:[String(rows.filter(x=>x[1]===500).length)],why:"Match the status field exactly.",sol:"awk '$2==500{n++} END{print n}' ~/oncall/shift.log"};
  if(lvl==="logpath"){const m={};rows.filter(x=>x[1]===500).forEach(x=>m[x[0]]=(m[x[0]]||0)+1);const s=Object.entries(m).sort((a,b)=>b[1]-a[1]);if(s.length>1&&s[0][1]===s[1][1])return genOncall();return{...bl,title:"Which endpoint is failing?",brief:"Which path has the most 500 responses?",answer:[s[0][0]],why:"Filter, then count by path.",sol:"awk '$2==500{print $1}' ~/oncall/shift.log | sort | uniq -c | sort -rn | head -1"}}
  return{...bl,title:"The slowest call",brief:"What is the highest ms value?",answer:[String(Math.max(...rows.map(x=>x[2])))],why:"Sort numerically on the third column.",sol:"sort -k3 -n ~/oncall/shift.log | tail -1"}}
