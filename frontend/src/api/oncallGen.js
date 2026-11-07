/* On-call incident generator, ported from the legacy game. M11 moves this to the server
   with a seed, so answers never reach the browser (section 6.9). */
import { S } from '../../../engines/host.js';
import { HOME, joinL, rng } from '../../../engines/fs/index.js';
import { writeFile } from '../../../engines/shell/index.js';

const toIp=n=>[n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join(".");
export function genOncall(){const r=rng(Date.now()^(S.ocTotal*7919)),n=k=>Math.floor(r()*k),pick=a=>a[n(a.length)];
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
