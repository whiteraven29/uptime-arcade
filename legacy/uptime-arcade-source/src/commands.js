/* ========== commands ========== */
const fmtMode=n=>{const b=n.m&0o777,bit=(v,c)=>v?c:"-";return(n.t==="d"?"d":"-")+[6,3,0].map(s=>bit(b&(4<<s),"r")+bit(b&(2<<s),"w")+bit(b&(1<<s),"x")).join("")};
function netLive(){return S.net||{gw:"10.40.3.1"}}
function resolver(){const c=(fs.get("/etc/resolv.conf")||{}).c||"";const m=/^nameserver\s+(\S+)/m.exec(c);return m?m[1]:null}
const ZONE={"app.whiteraven.example":"10.40.10.80","mail.whiteraven.example":"10.40.10.25","docs.whiteraven.example":"10.40.10.81"};
const DNS_OK="10.40.10.53";
const COMMANDS={
  pwd:()=>S.cwd+"\n",
  whoami:()=>"ops\n",
  hostname:()=>HOST+"\n",
  date:()=>new Date().toString()+"\n",
  echo(a){let n=false,e=false;while(a[0]==="-n"||a[0]==="-e"){if(a[0]==="-n")n=true;else e=true;a=a.slice(1)}let s=a.join(" ");if(e)s=s.replace(/\\n/g,"\n").replace(/\\t/g,"\t");return s+(n?"":"\n")},
  seq(a){const n=a.map(Number),[s,t,e]=n.length===1?[1,1,n[0]]:n.length===2?[n[0],1,n[1]]:n;const o=[];for(let i=s;t>0?i<=e:i>=e;i+=t)o.push(i);return joinL(o)},
  cd(a){const t=norm(a[0]||"~"===a[0]?a[0]:HOME),n=fs.get(t);
    if(!n)return sh.e(`cd: ${a[0]}: No such file or directory`);
    if(n.t!=="d")return sh.e(`cd: ${a[0]}: Not a directory`);S.cwd=t},
  ls(a){const[o,r]=opts(a);const list=r.length?r:["."];const out=[];
    const row=(p,nm)=>{const n=fs.get(p);return o.l?`${fmtMode(n)} 1 ops ops ${String(n.t==="d"?4096:n.c.length).padStart(7)} ${n.mt} ${nm}`:nm};
    for(const x of list){const p=norm(x),n=fs.get(p);
      if(!n){sh.e(`ls: cannot access '${x}': No such file or directory`);continue}
      if(n.t!=="d"){out.push(row(p,x));continue}
      if(list.length>1)out.push(x+":");
      let k=fs.kids(p).map(c=>[c,c.slice(c.lastIndexOf("/")+1)]);
      if(!o.a&&!o.A)k=k.filter(c=>!c[1].startsWith("."));
      const names=k.map(c=>row(c[0],c[1]));
      if(o.a)names.unshift(row(p,"."));
      out.push(...names)}
    return joinL(out)},
  cat(a,inp){const[o,r]=opts(a);const t=inputs(r,inp,"cat");if(!o.n)return t;return joinL(lines(t).map((l,i)=>String(i+1).padStart(6)+"  "+l))},
  head(a,inp){const[o,r]=opts(a,"n");const n=+(o.n||o.num||10);return joinL(lines(inputs(r,inp,"head")).slice(0,n))},
  tail(a,inp){const[o,r]=opts(a,"n");const raw=String(o.n||o.num||10),L=lines(inputs(r,inp,"tail"));return joinL(raw.startsWith("+")?L.slice(+raw.slice(1)-1):L.slice(-+raw))},
  wc(a,inp){const[o,r]=opts(a);const t=inputs(r,inp,"wc"),l=lines(t).length,w=(t.match(/\S+/g)||[]).length,c=t.length;const f=r[0]&&r.length===1?" "+r[0]:"";
    if(o.l)return l+f+"\n";if(o.w)return w+f+"\n";if(o.c)return c+f+"\n";return`${String(l).padStart(4)} ${String(w).padStart(4)} ${String(c).padStart(5)}${f}\n`},
  sort(a,inp){const[o,r]=opts(a,"kt");let L=lines(inputs(r,inp,"sort"));
    const key=l=>{if(!o.k)return l;const k=parseInt(o.k,10)-1;const f=o.t?l.split(o.t):l.trim().split(/\s+/);return f[k]??""};
    const cmp=(x,y)=>{const a1=key(x),b1=key(y);if(o.n){return(parseFloat(a1)||0)-(parseFloat(b1)||0)}return a1<b1?-1:a1>b1?1:0};
    L=L.map((l,i)=>[l,i]).sort((x,y)=>(cmp(x[0],y[0])||x[1]-y[1])).map(x=>x[0]);
    if(o.r)L.reverse();if(o.u)L=L.filter((l,i)=>i===0||key(l)!==key(L[i-1]));return joinL(L)},
  uniq(a,inp){const[o,r]=opts(a);const L=lines(inputs(r,inp,"uniq")),g=[];for(const l of L){if(g.length&&g[g.length-1][0]===l)g[g.length-1][1]++;else g.push([l,1])}
    return joinL(g.filter(x=>o.d?x[1]>1:true).map(x=>o.c?String(x[1]).padStart(7)+" "+x[0]:x[0]))},
  cut(a,inp){const[o,r]=opts(a,"dfc");const L=lines(inputs(r,inp,"cut"));
    const want=(spec,max)=>{const s=new Set();for(const p of spec.split(",")){const m=/^(\d*)(-?)(\d*)$/.exec(p);const lo=+m[1]||1,hi=m[2]?(+m[3]||max):lo;for(let i=lo;i<=hi&&i<=max;i++)s.add(i)}return[...s].sort((x,y)=>x-y)};
    if(o.c)return joinL(L.map(l=>want(o.c,l.length).map(i=>l[i-1]).join("")));
    if(!o.f)return sh.e("cut: you must specify a list of fields with -f");
    const d=o.d||"\t";return joinL(L.map(l=>{if(!l.includes(d))return l;const f=l.split(d);return want(o.f,f.length).map(i=>f[i-1]).join(d)}))},
  tr(a,inp){const[o,r]=opts(a);const exp=s=>s.replace(/\[:upper:\]/g,"A-Z").replace(/\[:lower:\]/g,"a-z").replace(/\[:digit:\]/g,"0-9").replace(/\\n/g,"\n").replace(/\\t/g,"\t").replace(/\\r/g,"\r").replace(/(.)-(.)/g,(_,x,y)=>{let s2="";for(let c=x.charCodeAt(0);c<=y.charCodeAt(0);c++)s2+=String.fromCharCode(c);return s2});
    const t=inp??"",A=exp(r[0]||""),B=exp(r[1]||"");
    if(o.d)return[...t].filter(c=>!A.includes(c)).join("");
    let res=[...t].map(c=>{const i=A.indexOf(c);return i<0||!B?c:B[Math.min(i,B.length-1)]}).join("");
    if(o.s){const set=B||A;res=res.replace(/([\s\S])\1+/g,(m,c)=>set.includes(c)?c:m)}return res},
  grep(a,inp){const[o,r]=opts(a,"e");const pat=o.e||r.shift();if(pat===undefined)return sh.e("grep: usage: grep [options] PATTERN [FILE...]");
    const re=rx(pat,{ere:o.E,fixed:o.F,i:o.i,word:o.w,g:true}),res=[];let found=false;const quiet=o.q;
    const targets=[];
    if(!r.length&&o.r)r.push(".");
    if(!r.length)targets.push([null,inp??""]);
    for(const f of r){const p=norm(f),n=fs.get(p);
      if(!n){sh.e(`grep: ${f}: No such file or directory`);continue}
      if(n.t==="d"){if(!o.r){sh.e(`grep: ${f}: Is a directory`);continue}walk(p,(q,m)=>{if(m.t==="f")targets.push([f==="."?"."+q.slice(S.cwd.length):q,m.c])});continue}
      targets.push([f,n.c])}
    const multi=targets.length>1||o.r;
    for(const[name,text]of targets){let c=0;const L=lines(text);
      L.forEach((l,i)=>{re.lastIndex=0;const hit=re.test(l);re.lastIndex=0;if(hit===!!o.v)return;c++;found=true;if(o.c||o.l)return;
        const pre=(multi&&!o.h&&name?name+":":"")+(o.n?(i+1)+":":"");
        if(o.o&&!o.v){for(const m of l.matchAll(re)){if(m[0])res.push(pre+m[0])}}else res.push(pre+l)});
      if(o.c)res.push((multi&&name?name+":":"")+c);if(o.l&&c)res.push(name||"(standard input)")}
    if(!found)sh.code=1;return quiet?"":joinL(res)},
  egrep(a,inp){return COMMANDS.grep(["-E",...a],inp)},
  sed(a,inp){const[o,r]=opts(a,"e");let script=o.e;if(script===undefined)script=r.shift();if(o.i&&typeof o.i==="string"){r.unshift(o.i)}
    if(script===undefined)return sh.e("sed: usage: sed [-n] [-E] [-i] SCRIPT [FILE]");
    const m={n:o.n,ere:o.E||o.r};
    if(o.i){for(const f of r){const c=readFile(norm(f),"sed",f);if(c!==null)writeFile(norm(f),sedRun(script,c,m),"sed")}return""}
    return sedRun(script,inputs(r,inp,"sed"),m)},
  awk(a,inp){const[o,r]=opts(a,"Fv");const prog=r.shift();if(prog===undefined)return sh.e("awk: usage: awk [-F sep] 'program' [file]");
    const vars={};if(o.v){const k=o.v.indexOf("=");vars[o.v.slice(0,k)]=o.v.slice(k+1)}
    return awkRun(prog,inputs(r,inp,"awk"),{fs:o.F==="\\t"?"\t":o.F,vars})},
  find(a){let i=0;const roots=[];while(i<a.length&&!a[i].startsWith("-")){roots.push(a[i++])}if(!roots.length)roots.push(".");
    const t=[];let exec=null,depth=Infinity,del=false;
    while(i<a.length){const x=a[i++];
      if(x==="-name")t.push(((re,f)=>(p)=>f(re,p))(globRe(a[i++]),(re,p)=>re.test(p.slice(p.lastIndexOf("/")+1))));
      else if(x==="-iname"){const re=new RegExp(globRe(a[i++]).source,"i");t.push(p=>re.test(p.slice(p.lastIndexOf("/")+1)))}
      else if(x==="-type"){const k=a[i++];t.push((p,n)=>n.t===k)}
      else if(x==="-maxdepth")depth=+a[i++];
      else if(x==="-delete")del=true;
      else if(x==="-print"){}
      else if(x==="-exec"){const c=[];while(i<a.length&&a[i]!==";")c.push(a[i++]);i++;exec=c}
      else return sh.e(`find: unknown predicate '${x}'`)}
    const out=[];
    for(const r of roots){const R=norm(r);if(!fs.get(R)){sh.e(`find: ‘${r}’: No such file or directory`);continue}
      const bd=R==="/"?0:R.split("/").length-1;
      walk(R,(p,n)=>{const dp=(p==="/"?0:p.split("/").length-1)-bd;if(dp>depth)return;if(!t.every(f=>f(p,n)))return;
        const shown=p===R?r:(r==="."?"."+p.slice(R.length):r.replace(/\/$/,"")+p.slice(R.length));
        if(del){fs.del(p);return}
        if(exec){const c=exec.map(w=>w==="{}"?shown:w);const fn=COMMANDS[c[0]];if(fn)out.push(fn(c.slice(1),null)||"");else sh.e(`find: ${c[0]}: not found`)}else out.push(shown+"\n")})}
    return out.join("")},
  mv(a){const[,r]=opts(a);if(r.length!==2)return sh.e("mv: expected a source and a destination");const s=norm(r[0]);let d=norm(r[1]);const n=fs.get(s);
    if(!n)return sh.e(`mv: cannot stat '${r[0]}': No such file or directory`);
    const dn=fs.get(d);if(dn&&dn.t==="d")d=d+"/"+s.slice(s.lastIndexOf("/")+1);
    if(!fs.get(d.slice(0,d.lastIndexOf("/"))||"/"))return sh.e(`mv: cannot move to '${r[1]}': No such file or directory`);
    fs.put(d,n);fs.del(s)},
  cp(a){const[,r]=opts(a);if(r.length!==2)return sh.e("cp: expected a source and a destination");const s=norm(r[0]);let d=norm(r[1]);const n=fs.get(s);
    if(!n)return sh.e(`cp: cannot stat '${r[0]}': No such file or directory`);if(n.t==="d")return sh.e("cp: this box copies files only");
    const dn=fs.get(d);if(dn&&dn.t==="d")d=d+"/"+s.slice(s.lastIndexOf("/")+1);fs.put(d,{...n})},
  rm(a){const[o,r]=opts(a);for(const f of r){const p=norm(f),n=fs.get(p);if(!n){if(!o.f)sh.e(`rm: cannot remove '${f}': No such file or directory`);continue}
      if(n.t==="d"&&!o.r)sh.e(`rm: cannot remove '${f}': Is a directory`);else{const all=[];walk(p,q=>all.push(q));all.forEach(q=>fs.del(q))}}},
  mkdir(a){const[o,r]=opts(a);for(const f of r){const p=norm(f);if(fs.get(p)){if(!o.p)sh.e(`mkdir: cannot create directory '${f}': File exists`);continue}
      const parts=p.split("/").filter(Boolean);let c="";for(let i=0;i<parts.length;i++){c+="/"+parts[i];if(fs.get(c))continue;if(i<parts.length-1&&!o.p){sh.e(`mkdir: cannot create directory '${f}': No such file or directory`);break}fs.put(c,{t:"d",m:0o755,mt:"Nov  6 09:00"})}}},
  touch(a){for(const f of a){const p=norm(f);if(!fs.get(p))writeFile(p,"","touch")}},
  chmod(a){const[m,...r]=a;for(const f of r){const p=norm(f),n=fs.get(p);if(!n){sh.e(`chmod: cannot access '${f}': No such file or directory`);continue}
      let mode=n.m;if(/^[0-7]+$/.test(m))mode=parseInt(m,8);else if(m==="+x")mode|=0o111;else if(m==="-x")mode&=~0o111;fs.put(p,{...n,m:mode})}},
  tee(a,inp){const[o,r]=opts(a);for(const f of r)writeFile(norm(f),inp??"","tee",o.a);return inp},
  xargs(a,inp){const[o,r]=opts(a,"n");const items=(inp||"").split(/\s+/).filter(Boolean);const cmd=r[0]||"echo",fn=COMMANDS[cmd];if(!fn)return sh.e(`xargs: ${cmd}: not found`);
    const n=+(o.n||items.length||1);let out="";for(let i=0;i<items.length;i+=n)out+=fn([...r.slice(1),...items.slice(i,i+n)],null)||"";return out},
  bash(a){return runScript(norm(a[0]||""))},
  sh(a){return runScript(norm(a[0]||""))},
  rev(a,inp){return joinL(lines(inputs(a,inp,"rev")).map(l=>[...l].reverse().join("")))},
  tac(a,inp){return joinL(lines(inputs(a,inp,"tac")).reverse())},
  nl(a,inp){return joinL(lines(inputs(a,inp,"nl")).map((l,i)=>String(i+1).padStart(6)+"  "+l))},
  basename(a){return a[0].replace(/\/$/,"").split("/").pop()+"\n"},
  dirname(a){const p=a[0].replace(/\/$/,"");return(p.includes("/")?p.slice(0,p.lastIndexOf("/"))||"/":".")+"\n"},
  printf(a){let k=1;return(a[0]||"").replace(/\\n/g,"\n").replace(/\\t/g,"\t").replace(/%(-?\d*)s|%d/g,()=>a[k++]??"")},
  paste(a,inp){const[o,r]=opts(a,"d");const cols=r.map(f=>lines(readFile(norm(f),"paste",f)??""));const n=Math.max(0,...cols.map(c=>c.length)),out=[];for(let i=0;i<n;i++)out.push(cols.map(c=>c[i]??"").join(o.d||"\t"));return joinL(out)},
  diff(a){const[,r]=opts(a);if(r.length<2)return sh.e("diff: needs two files");const[x,y]=r.map(f=>readFile(norm(f),"diff",f));if(x===null||y===null)return;const A=lines(x),B=lines(y),o=[];for(let i=0;i<Math.max(A.length,B.length);i++){if(A[i]!==B[i]){o.push(`${i+1}c${i+1}`);if(A[i]!==undefined)o.push("< "+A[i]);o.push("---");if(B[i]!==undefined)o.push("> "+B[i])}}if(o.length)sh.code=1;return joinL(o)},
  history(){return joinL(S.hist.map((h,i)=>String(i+1).padStart(5)+"  "+h))},
  /* networking */
  ip(a){const sub=a[0]||"";
    if(/^a(ddr)?$/.test(sub)||sub==="address")return`1: lo: <LOOPBACK,UP> mtu 65536 state UNKNOWN
    inet 127.0.0.1/8 scope host lo
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP
    link/ether 52:54:00:3a:7e:21 brd ff:ff:ff:ff:ff:ff
    inet 10.40.30.21/24 brd 10.40.30.255 scope global eth0
`;
    if(/^r(oute)?$/.test(sub))return`default via ${netLive().gw} dev eth0 proto static
10.40.30.0/24 dev eth0 proto kernel scope link src 10.40.30.21
`;
    return sh.e("ip: try 'ip addr' or 'ip route'")},
  netplan(a){if(a[0]!=="apply")return sh.e("netplan: try 'netplan apply'");const c=(fs.get("/etc/netplan/01-office.yaml")||{}).c||"";
    const m=/via:\s*([\d.]+)/.exec(c);if(!m)return sh.e("netplan: could not find a 'via:' gateway in /etc/netplan/01-office.yaml");
    S.net={gw:m[1]};return`Applied. Default gateway is now ${m[1]}.\n`},
  ping(a){const[o,r]=opts(a,"c");const h=r[0];if(!h)return sh.e("ping: usage: ping [-c count] host");const c=+(o.c||3);
    let ip=h;if(!/^[\d.]+$/.test(h)){if(resolver()!==DNS_OK||!ZONE[h]){sh.code=2;return sh.e(`ping: ${h}: Temporary failure in name resolution`)}ip=ZONE[h]}
    const local=ip.startsWith("10.40.30.")||ip==="127.0.0.1";
    if(!local&&netLive().gw!=="10.40.30.1"){sh.code=1;return`PING ${h} (${ip}) 56(84) bytes of data.\nFrom 10.40.30.21 icmp_seq=1 Destination Host Unreachable\n\n--- ${h} ping statistics ---\n${c} packets transmitted, 0 received, 100% packet loss\n`}
    if(local&&!["10.40.30.1","10.40.30.21","127.0.0.1"].includes(ip)){sh.code=1;return`PING ${h} (${ip}) 56(84) bytes of data.\n\n--- ${h} ping statistics ---\n${c} packets transmitted, 0 received, 100% packet loss\n`}
    const o2=[`PING ${h} (${ip}) 56(84) bytes of data.`];for(let i=1;i<=c;i++)o2.push(`64 bytes from ${ip}: icmp_seq=${i} ttl=62 time=${(3+i*.7).toFixed(1)} ms`);
    o2.push("",`--- ${h} ping statistics ---`,`${c} packets transmitted, ${c} received, 0% packet loss`);return joinL(o2)},
  dig(a){const h=a.filter(x=>!x.startsWith("+")&&!x.startsWith("@"))[0];if(!h)return sh.e("dig: usage: dig name");const ns=resolver();
    if(ns!==DNS_OK)return`;; connection timed out; no servers could be reached (tried ${ns||"none"})\n`;
    if(!ZONE[h])return`;; ->>HEADER<<- status: NXDOMAIN\n;; SERVER: ${ns}#53\n`;
    if(a.includes("+short"))return ZONE[h]+"\n";
    return`;; ->>HEADER<<- status: NOERROR\n;; ANSWER SECTION:\n${h}. 300 IN A ${ZONE[h]}\n;; SERVER: ${ns}#53\n`},
};
COMMANDS.vim=(a)=>COMMANDS.vi(a);
COMMANDS.vi=(a)=>{if(!a[0])return sh.e("vi: name a file, for example: vi notes.txt");viOpen(norm(a[0]),a[0])};

/* man pages: real flags, no ticket answers */
const MAN={
  ls:"ls [-a] [-l] [path]\n  -a  include names starting with a dot\n  -l  long format with mode, size and date",
  cd:"cd [dir]   no argument returns home. cd .. moves up one level.",
  cat:"cat [-n] [file...]\n  -n  number lines\n  A name starting with - reads as an option. Write ./-name or use cat -- -name.",
  grep:"grep [-i -v -n -c -l -o -r -E -F -w] PATTERN [file...]\n  -i ignore case   -v invert match   -n line numbers\n  -c count         -o print only the match\n  -r recurse       -E extended regex",
  sort:"sort [-n -r -u] [-t sep] [-k field] [file]\n  -n numeric   -r reverse   -u unique\n  -t set field separator   -k sort on field N",
  uniq:"uniq [-c -d]  collapses adjacent duplicates, so sort first.\n  -c prefix each line with its count\n  -d show only repeated lines",
  cut:"cut -d SEP -f LIST [file]\n  -f 1,3  or  -f 2-4  or  -c 1-8 for characters",
  wc:"wc [-l -w -c]   count lines, words, bytes",
  head:"head [-n N] [file]   first N lines (default 10)",
  tail:"tail [-n N] [file]   last N lines. tail -n +2 starts from line 2 (skips a header).",
  tr:"tr SET1 SET2   translate characters from stdin\n  -d delete SET1   -s squeeze repeats\n  tr a-z A-Z uppercases",
  sed:"sed [-n] [-E] [-i] 'SCRIPT' [file]\n  s/old/new/g   substitute. With -E use (group) and \\1 in the replacement.\n  /re/d         delete matching lines\n  2,5p          with -n, print lines 2 to 5\n  -i            edit the file in place",
  awk:"awk [-F sep] 'pattern {action}' [file]\n  $1 $2 fields, $NF last field, NR record number, NF field count\n  sum:  {s[$1]+=$2} END {for (k in s) print k, s[k]}\n  NR>1 skips a header row\n  Comparisons, regex /x/, ~, printf, substr, split, length, toupper all work here.",
  find:"find [path] [-name GLOB] [-iname GLOB] [-type f|d] [-maxdepth N] [-exec cmd {} \\;] [-delete]",
  vi:"vi FILE  (modal editor)\n  Motions: h j k l w b e 0 ^ $ gg G f{c} ; /text n N\n  Change:  x r{c} i a I A o O dd dw D cw C J yy p P u .\n  Counts:  3j, 2dd, 4w\n  Indent:  >> and <<\n  Replace: :%s/old/new/g\n  Save:    :w  :q  :q!  :wq  ZZ",
  ip:"ip addr    interfaces and addresses\nip route   routing table. 'default via X' is the gateway.",
  ping:"ping [-c N] host   test reachability. A name needs working DNS first.",
  dig:"dig NAME [+short]   ask the configured DNS server. Server comes from /etc/resolv.conf.",
  netplan:"netplan apply   load /etc/netplan/*.yaml into the live network config",
  while:"while read h; do echo \"$h\"; done < file\n  Reads a file line by line. Add > out after the file to collect output.",
  diff:"diff A B   shows lines that differ. < is from A, > is from B.",
  paste:"paste -d, A B   joins two files side by side",
  chmod:"chmod +x file   makes a file runnable by path",
  for:"for x in a b c; do echo \"$x\"; done\n  Quote \"$x\" so names with spaces stay one word.\n  ${x%.old}  removes .old from the end of x.",
  mv:"mv SRC DEST   move or rename",
};
