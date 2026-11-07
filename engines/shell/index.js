/* Shell engine: parser, pipelines, globbing, awk and sed interpreters.
   Ported from legacy/uptime-arcade-source/src. Framework-free: no React, no DOM. */
import { S, host } from '../host.js';
import { HOME, F, fs, lines, joinL, norm } from '../fs/index.js';
import { COMMANDS } from './commands.js';

const sh={env:{},code:0,sink:null,errSink:null,
  out(t){if(this.sink)this.sink.push(t)},
  e(t){if(this.errSink)this.errSink.push(t+"\n");else host.err(t);this.code=1}};

function readFile(p,name,shown){const n=fs.get(p);
  if(!n){sh.e(`${name}: ${shown}: No such file or directory`);return null}
  if(n.t==="d"){sh.e(`${name}: ${shown}: Is a directory`);return null}
  return n.c}
function writeFile(p,c,name,append){
  if(p==="/dev/null")return true;
  const n=fs.get(p),dir=p.slice(0,p.lastIndexOf("/"))||"/";
  if(!fs.get(dir)){sh.e(`${name}: ${p}: No such file or directory`);return false}
  if(n&&n.t==="d"){sh.e(`${name}: ${p}: Is a directory`);return false}
  fs.put(p,n?{...n,c:append?n.c+c:c,mt:"Nov  6 09:00"}:{t:"f",c,m:0o644,mt:"Nov  6 09:00"});return true}
function walk(p,cb){const n=fs.get(p);if(!n)return;cb(p,n);if(n.t==="d")for(const k of fs.kids(p))walk(k,cb)}

/* ========== regex translation ========== */
function rx(p,o={}){
  if(o.fixed)p=p.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  else{
    p=p.replace(/\[:(digit|alpha|alnum|space|upper|lower):\]/g,(_,c)=>({digit:"0-9",alpha:"A-Za-z",alnum:"A-Za-z0-9",space:"\\s",upper:"A-Z",lower:"a-z"}[c]));
    if(!o.ere){let r="",br=false;for(let i=0;i<p.length;i++){const c=p[i];
      if(br){r+=c;if(c==="]"&&p[i-1]!=="[")br=false;continue}
      if(c==="["){br=true;r+=c;continue}
      if(c==="\\"&&"()|+?{}".includes(p[i+1]||" ")){r+=p[++i];continue}
      if("()|+?{}".includes(c)){r+="\\"+c;continue}
      r+=c}
      p=r}
  }
  if(o.word)p="\\b(?:"+p+")\\b";
  return new RegExp(p,(o.g?"g":"")+(o.i?"i":""));
}
const globRe=g=>new RegExp("^"+g.replace(/[.+^${}()|\\]/g,"\\$&").replace(/\*/g,".*").replace(/\?/g,".")+"$");

/* ========== option parsing ========== */
function opts(a,valued=""){const o={},rest=[];let stop=false;
  for(let i=0;i<a.length;i++){const x=a[i];
    if(stop||x==="-"||!x.startsWith("-")||x.length<2){rest.push(x);continue}
    if(x==="--"){stop=true;continue}
    if(x.startsWith("--")){o[x.slice(2).split("=")[0]]=x.split("=")[1]??true;continue}
    if(/^-\d+$/.test(x)){o.num=x.slice(1);continue}
    for(let j=1;j<x.length;j++){const c=x[j];
      if(valued.includes(c)){o[c]=x.slice(j+1)||a[++i]||"";break}
      o[c]=true}}
  return[o,rest]}
function inputs(files,inp,name){if(!files.length||(files.length===1&&files[0]==="-"))return inp??"";let r="";for(const f of files){const c=readFile(norm(f),name,f);if(c!==null)r+=c}return r}

/* ========== awk: a small real interpreter ========== */
function awkRun(src,text,cfg){
  const T=[];let i=0;const KW=new Set(["BEGIN","END","if","else","for","in","while","print","printf","next","delete","exit"]);
  const prevVal=()=>{const t=T[T.length-1];return t&&(t.k==="num"||t.k==="str"||t.k==="name"||t.v===")"||t.v==="]")};
  while(i<src.length){const c=src[i];
    if(c===" "||c==="\t"){i++;continue}
    if(c==="\n"||c===";"){T.push({k:"p",v:";"});i++;continue}
    if(c==="#"){while(i<src.length&&src[i]!=="\n")i++;continue}
    if(/[0-9]/.test(c)||(c==="."&&/[0-9]/.test(src[i+1]||""))){const m=/^\d*\.?\d+(?:[eE][+-]?\d+)?|^\d+\.?/.exec(src.slice(i));T.push({k:"num",v:parseFloat(m[0])});i+=m[0].length;continue}
    if(/[A-Za-z_]/.test(c)){const m=/^[A-Za-z_]\w*/.exec(src.slice(i));i+=m[0].length;T.push({k:KW.has(m[0])?"kw":"name",v:m[0],call:src[i]==="("});continue}
    if(c==='"'){let s="";i++;while(i<src.length&&src[i]!=='"'){if(src[i]==="\\"){i++;const e=src[i];s+=e==="n"?"\n":e==="t"?"\t":e}else s+=src[i];i++}i++;T.push({k:"str",v:s});continue}
    if(c==="/"&&!prevVal()){let s="";i++;while(i<src.length&&src[i]!=="/"){if(src[i]==="\\"&&src[i+1]==="/"){s+="/";i+=2;continue}s+=src[i];i++}i++;T.push({k:"re",v:s});continue}
    const two=src.slice(i,i+2);
    if(["==","!=","<=",">=","&&","||","!~","++","--","+=","-=","*=","/=","%="].includes(two)){T.push({k:"p",v:two});i+=2;continue}
    T.push({k:"p",v:c});i++}
  let p=0;const peek=()=>T[p]||{k:"eof",v:""},is=v=>peek().v===v&&peek().k!=="str",eat=v=>{if(!is(v))throw new Error(`syntax error near '${peek().v}'`);p++};
  const skip=()=>{while(is(";"))p++};
  const V={FS:cfg.fs??" ",OFS:" ",...cfg.vars},F={rec:"",f:[],NR:0};
  const num=v=>typeof v==="number"?v:(parseFloat(v)||0);
  const str=v=>typeof v==="number"?(Number.isInteger(v)?String(v):String(+v.toPrecision(6))):(v??"")+"";
  const numLike=v=>typeof v==="number"||/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(v??"");
  const split=s=>{const d=V.FS;if(d===" ")return s.trim()?s.trim().split(/\s+/):[];if(!s)return[];return d.length===1?s.split(d):s.split(rx(d,{ere:true}))};
  const setRec=s=>{F.rec=s;F.f=split(s)};
  const getF=n=>n===0?F.rec:F.f[n-1]??"";
  const setF=(n,v)=>{if(n===0)return setRec(str(v));for(let k=0;k<n;k++)F.f[k]??="";F.f[n-1]=str(v);F.rec=F.f.join(V.OFS)};
  const getV=n=>n==="NR"?F.NR:n==="NF"?F.f.length:V[n]??"";
  const printf=(fmt,a)=>{let k=0;return fmt.replace(/%(-?)(\d*)(?:\.(\d+))?([sdfc%])/g,(_,l,w,pr,t)=>{if(t==="%")return"%";const v=a[k++];let s=t==="s"||t==="c"?str(v):t==="d"?String(Math.trunc(num(v))):num(v).toFixed(pr===undefined?6:+pr);if(t==="s"&&pr!==undefined)s=s.slice(0,+pr);return l?s.padEnd(+w||0):s.padStart(+w||0)})};
  function primary(){const t=peek();
    if(t.k==="num"||t.k==="str"){p++;return{g:()=>t.v}}
    if(t.k==="re"){p++;const r=rx(t.v,{ere:true});return{g:()=>r.test(F.rec)?1:0,re:r}}
    if(is("$")){p++;const e=unary();return{g:()=>getF(Math.trunc(num(e.g()))),s:v=>setF(Math.trunc(num(e.g())),v)}}
    if(is("(")){p++;const e=expr();eat(")");return e}
    if(is("++")||is("--")){const d=is("++")?1:-1;p++;const e=postfix();return{g:()=>{const n=num(e.g())+d;e.s(n);return n}}}
    if(t.k==="name"){p++;
      if(t.call){eat("(");const a=[];while(!is(")")){a.push(expr());if(is(","))p++;else break}eat(")");return call(t.v,a)}
      if(is("[")){p++;const e=expr();eat("]");const n=t.v;return{g:()=>{if(typeof V[n]!=="object")V[n]={};return V[n][str(e.g())]??""},s:v=>{if(typeof V[n]!=="object")V[n]={};V[n][str(e.g())]=v}}}
      const n=t.v;return{g:()=>getV(n),s:v=>{V[n]=v}}}
    throw new Error(`syntax error near '${t.v}'`)}
  function call(n,a){const A=()=>a.map(x=>x.g());
    if(n==="length")return{g:()=>{if(!a.length)return F.rec.length;const v=a[0].g();return typeof v==="object"?Object.keys(v).length:str(v).length}};
    if(n==="substr")return{g:()=>{const v=A(),s=str(v[0]),st=Math.max(1,Math.round(num(v[1])));return v.length>2?s.slice(st-1,st-1+Math.round(num(v[2]))):s.slice(st-1)}};
    if(n==="index")return{g:()=>{const v=A();return str(v[0]).indexOf(str(v[1]))+1}};
    if(n==="tolower")return{g:()=>str(a[0].g()).toLowerCase()};
    if(n==="toupper")return{g:()=>str(a[0].g()).toUpperCase()};
    if(n==="int")return{g:()=>Math.trunc(num(a[0].g()))};
    if(n==="sprintf")return{g:()=>{const v=A();return printf(str(v[0]),v.slice(1))}};
    if(n==="split")return{g:()=>{const parts=a[2]?str(a[0].g()).split(str(a[2].g())):split(str(a[0].g()));const o={};parts.forEach((x,k)=>o[k+1]=x);a[1].s(o);return parts.length}};
    if(n==="sub"||n==="gsub")return{g:()=>{const r=a[0].re?new RegExp(a[0].re.source,n==="gsub"?"g":""):rx(str(a[0].g()),{ere:true,g:n==="gsub"});const rep=str(a[1].g()).replace(/\$/g,"$$$$").replace(/&/g,"$$&");const t2=a[2]||{g:()=>F.rec,s:v=>setRec(v)};const s=str(t2.g());let c=0;const out=s.replace(r,m=>{c++;return m.replace(/^[\s\S]*$/,()=>rep.replace(/\$&/g,m).replace(/\$\$/g,"$"))});if(c)t2.s(out);return c}};
    throw new Error(`function ${n} not supported here`)}
  function postfix(){const e=primary();if(is("++")||is("--")){const d=is("++")?1:-1;p++;return{g:()=>{const v=num(e.g());e.s(v+d);return v}}}return e}
  function unary(){if(is("!")){p++;const e=unary();return{g:()=>truth(e.g())?0:1}}if(is("-")){p++;const e=unary();return{g:()=>-num(e.g())}}if(is("+")){p++;const e=unary();return{g:()=>num(e.g())}}return postfix()}
  function mul(){let l=unary();while(is("*")||is("/")||is("%")){const o=peek().v;p++;const a=l,b=unary();l={g:()=>{const x=num(a.g()),y=num(b.g());return o==="*"?x*y:o==="/"?x/y:x%y}}}return l}
  function add(){let l=mul();while(is("+")||is("-")){const o=peek().v;p++;const a=l,b=mul();l={g:()=>o==="+"?num(a.g())+num(b.g()):num(a.g())-num(b.g())}}return l}
  function concat(){let l=add();for(;;){const t=peek();if(t.k==="num"||t.k==="str"||t.k==="name"||is("$")||is("(")){const a=l,b=add();l={g:()=>str(a.g())+str(b.g())}}else break}return l}
  function cmp(){const l=concat();const o=peek().v;if(peek().k==="p"&&["==","!=","<",">","<=",">="].includes(o)){p++;const r=concat();return{g:()=>{const x=l.g(),y=r.g();let a,b;if(numLike(x)&&numLike(y)){a=num(x);b=num(y)}else{a=str(x);b=str(y)}return({"==":a===b,"!=":a!==b,"<":a<b,">":a>b,"<=":a<=b,">=":a>=b})[o]?1:0}}}return l}
  function match(){let l=cmp();while(is("~")||is("!~")){const neg=is("!~");p++;const a=l,b=cmp();l={g:()=>{const r=b.re||rx(str(b.g()),{ere:true});const h=r.test(str(a.g()));return(neg?!h:h)?1:0}}}return l}
  function inExpr(){let l=match();while(peek().k==="kw"&&peek().v==="in"){p++;const n=peek().v;p++;const a=l;l={g:()=>typeof V[n]==="object"&&str(a.g())in V[n]?1:0}}return l}
  function and(){let l=inExpr();while(is("&&")){p++;const a=l,b=inExpr();l={g:()=>truth(a.g())&&truth(b.g())?1:0}}return l}
  function or(){let l=and();while(is("||")){p++;const a=l,b=and();l={g:()=>truth(a.g())||truth(b.g())?1:0}}return l}
  function expr(){const l=or();
    if(is("?")){p++;const a=expr();eat(":");const b=expr();return{g:()=>truth(l.g())?a.g():b.g()}}
    const o=peek().v;if(peek().k==="p"&&["=","+=","-=","*=","/=","%="].includes(o)&&l.s){p++;const r=expr();return{g:()=>{let v=r.g();if(o!=="="){const c=num(l.g()),n=num(v);v=o==="+="?c+n:o==="-="?c-n:o==="*="?c*n:o==="/="?c/n:c%n}l.s(v);return v}}}
    return l}
  const truth=v=>typeof v==="number"?v!==0:numLike(v)?num(v)!==0:v!=="";
  class Next{} class Exit{}
  const out=[];
  function block(){eat("{");const b=[];skip();while(!is("}")){b.push(stmt());skip()}eat("}");return()=>{for(const s of b)s()}}
  function simpleEnd(){if(is(";"))p++}
  function stmt(){const t=peek();
    if(is("{"))return block();
    if(t.k==="kw"){
      if(t.v==="print"||t.v==="printf"){p++;const a=[];while(!is(";")&&!is("}")&&peek().k!=="eof"){a.push(expr());if(is(","))p++;else break}simpleEnd();
        if(t.v==="print")return()=>out.push((a.length?a.map(x=>str(x.g())).join(V.OFS):F.rec)+"\n");
        return()=>{const v=a.map(x=>x.g());out.push(printf(str(v[0]),v.slice(1)))}}
      if(t.v==="next"){p++;simpleEnd();return()=>{throw new Next()}}
      if(t.v==="exit"){p++;simpleEnd();return()=>{throw new Exit()}}
      if(t.v==="delete"){p++;const n=peek().v;p++;if(is("[")){p++;const e=expr();eat("]");simpleEnd();return()=>{if(V[n])delete V[n][str(e.g())]}}simpleEnd();return()=>{V[n]={}}}
      if(t.v==="if"){p++;eat("(");const c=expr();eat(")");skip();const a=stmt();skip();let b=null;if(peek().k==="kw"&&peek().v==="else"){p++;skip();b=stmt()}return()=>{if(truth(c.g()))a();else if(b)b()}}
      if(t.v==="while"){p++;eat("(");const c=expr();eat(")");skip();const a=stmt();return()=>{let n=0;while(truth(c.g())&&n++<100000)a()}}
      if(t.v==="for"){p++;eat("(");
        if(peek().k==="name"&&T[p+1]&&T[p+1].v==="in"){const k=peek().v;p+=2;const arr=peek().v;p++;eat(")");skip();const a=stmt();return()=>{for(const key of Object.keys(V[arr]||{})){V[k]=key;a()}}}
        const init=is(";")?null:expr();eat(";");const c=is(";")?null:expr();eat(";");const inc=is(")")?null:expr();eat(")");skip();const a=stmt();return()=>{if(init)init.g();let n=0;while((!c||truth(c.g()))&&n++<100000){a();if(inc)inc.g()}}}
    }
    const e=expr();simpleEnd();return()=>e.g()}
  const rules=[];const begin=[],end=[];
  skip();
  while(peek().k!=="eof"){
    if(peek().k==="kw"&&peek().v==="BEGIN"){p++;skip();begin.push(block())}
    else if(peek().k==="kw"&&peek().v==="END"){p++;skip();end.push(block())}
    else{let pat=null;if(!is("{"))pat=expr();const act=is("{")?block():()=>out.push(F.rec+"\n");rules.push({pat,act})}
    skip()}
  try{
    begin.forEach(b=>b());
    for(const l of lines(text)){F.NR++;setRec(l);
      try{for(const r of rules){if(!r.pat||truth(r.pat.g()))r.act()}}catch(x){if(!(x instanceof Next))throw x}}
    end.forEach(b=>b());
  }catch(x){if(!(x instanceof Exit))throw x}
  return out.join("");
}

/* ========== sed ========== */
function sedRun(script,text,o){
  const cmds=[];let i=0;
  const readDelim=d=>{let s="";while(i<script.length&&script[i]!==d){if(script[i]==="\\"&&script[i+1]===d){s+=d;i+=2;continue}if(script[i]==="\\"){s+=script[i]+script[i+1];i+=2;continue}s+=script[i++]}i++;return s};
  const addr=()=>{const c=script[i];
    if(/[0-9]/.test(c)){let n="";while(/[0-9]/.test(script[i]||""))n+=script[i++];return{n:+n}}
    if(c==="$"){i++;return{last:true}}
    if(c==="/"){i++;const r=readDelim("/");let ic=false;if(script[i]==="I"){ic=true;i++}return{re:rx(r,{ere:o.ere,i:ic})}}
    return null};
  while(i<script.length){
    while(/[\s;]/.test(script[i]||""))i++;
    if(i>=script.length)break;
    const a1=addr();let a2=null;if(a1&&script[i]===","){i++;a2=addr()}
    while(script[i]===" ")i++;
    let neg=false;if(script[i]==="!"){neg=true;i++}
    const c=script[i++];
    if(c==="s"){const d=script[i++],pat=readDelim(d),rep=readDelim(d);let fl="";while(/[gpiI0-9]/.test(script[i]||""))fl+=script[i++];
      const r=rx(pat,{ere:o.ere,g:fl.includes("g"),i:/[iI]/.test(fl)});
      const repl=rep.replace(/\\n/g,"\n").replace(/\$/g,"$$$$").replace(/\\(\d)/g,"$$$1").replace(/(^|[^\\])&/g,"$1$$&").replace(/\\&/g,"&");
      cmds.push({a1,a2,neg,c,r,repl,p:fl.includes("p")})}
    else if("dpq=".includes(c))cmds.push({a1,a2,neg,c});
    else throw new Error(`unknown command: '${c}'`)}
  const L=lines(text),out=[],total=L.length;
  const hit=(a,l,n)=>a.n!==undefined?n===a.n:a.last?n===total:a.re.test(l);
  for(const c of cmds)c.on=false;
  for(let k=0;k<L.length;k++){let l=L[k],del=false,quit=false;const n=k+1;
    for(const c of cmds){let m=true;
      if(c.a1){if(c.a2){if(c.on){m=true;if(hit(c.a2,l,n))c.on=false}else if(hit(c.a1,l,n)){m=true;c.on=!(c.a2.n!==undefined&&c.a2.n<=n)}else m=false}else m=hit(c.a1,l,n)}
      if(c.neg)m=!m;if(!m)continue;
      if(c.c==="d"){del=true;break}
      if(c.c==="p")out.push(l);
      if(c.c==="=")out.push(String(n));
      if(c.c==="q"){quit=true;break}
      if(c.c==="s"){const nl=l.replace(c.r,c.repl);if(nl!==l||c.r.test(l)){l=nl;if(c.p)out.push(l)}}}
    if(!del&&!o.n)out.push(l);
    if(quit)break}
  return joinL(out);
}

/* ========== tokenizer ========== */
function splitTop(s,seps){const parts=[];let cur="",q=null,d=0;
  for(let i=0;i<s.length;i++){const c=s[i];
    if(q){cur+=c;if(c==="\\"&&q==='"'){cur+=s[++i]??"";continue}if(c===q)q=null;continue}
    if(c==="'"||c==='"'){q=c;cur+=c;continue}
    if(c==="\\"){cur+=c+(s[++i]??"");continue}
    if(c==="$"&&s[i+1]==="("){d++;cur+="$(";i++;continue}
    if(c===")"&&d>0){d--;cur+=c;continue}
    if(d===0){const m=seps.find(x=>s.startsWith(x,i));if(m){parts.push({text:cur,sep:m});cur="";i+=m.length-1;continue}}
    cur+=c}
  parts.push({text:cur,sep:null});return parts}

function paramExpand(body){
  let m;
  if((m=/^#(\w+)$/.exec(body)))return String((sh.env[m[1]]??"").length);
  if((m=/^(\w+)(%%|%|##|#)(.*)$/.exec(body))){const v=sh.env[m[1]]??"",op=m[2],g=m[3];
    const src=g.replace(/[.+^${}()|\\]/g,"\\$&").replace(/\*/g,op.length===2?".*":".*?").replace(/\?/g,".");
    if(op[0]==="%"){const r=new RegExp((op==="%%"?"":"(?:^|.)*?")+"(?:"+src+")$");if(op==="%"){for(let k=v.length;k>=0;k--){if(new RegExp("^"+src+"$").test(v.slice(k)))return v.slice(0,k)}return v}return v.replace(r,"")}
    return v.replace(new RegExp("^"+src),"")}
  if((m=/^(\w+)\/([^/]*)\/(.*)$/.exec(body)))return(sh.env[m[1]]??"").replace(m[2],m[3]);
  return sh.env[body]??"";
}
function expand(src,i){ // src[i]==='$'
  const n=src[i+1];
  if(n==="("){let d=1,j=i+2;while(j<src.length&&d){if(src[j]==="(")d++;if(src[j]===")")d--;j++}
    return[capture(src.slice(i+2,j-1)).replace(/\n+$/,""),j]}
  if(n==="{"){const j=src.indexOf("}",i);return[paramExpand(src.slice(i+2,j)),j+1]}
  if(n==="?")return[String(sh.code),i+2];
  const m=/^\w+/.exec(src.slice(i+1));if(m)return[sh.env[m[0]]??(/^\d/.test(m[0])?"":""),i+1+m[0].length];
  return["$",i+1]}

function words(src){
  const toks=[];let i=0,cur=null;const n=src.length;
  const push=()=>{if(cur){toks.push(cur);cur=null}};
  const add=(t,g)=>{if(!cur)cur={s:"",glob:false};cur.s+=t;if(g)cur.glob=true};
  while(i<n){const c=src[i];
    if(c===" "||c==="\t"){push();i++;continue}
    if(c==="#"&&!cur)break;
    if(c===">"||c==="<"){let fd=null;if(cur&&/^[12]$/.test(cur.s)&&src[i-1]===cur.s){fd=cur.s;cur=null}else push();
      if(src.startsWith(">&1",i)){toks.push({dup:true});i+=3;continue}
      const op=src.startsWith(">>",i)?">>":c;i+=op.length;toks.push({op,fd});continue}
    if(c==="'"){const j=src.indexOf("'",i+1);if(j<0)throw new Error("unexpected end of line, unterminated quote");add(src.slice(i+1,j));i=j+1;continue}
    if(c==='"'){i++;add("");let closed=false;while(i<n){if(src[i]==='"'){closed=true;break}
        if(src[i]==="\\"&&'"\\$`'.includes(src[i+1]||" ")){add(src[i+1]);i+=2;continue}
        if(src[i]==="$"){const[v,j]=expand(src,i);add(v);i=j;continue}
        add(src[i]);i++}
      if(!closed)throw new Error("unexpected end of line, unterminated quote");i++;continue}
    if(c==="\\"){add(src[i+1]??"");i+=2;continue}
    if(c==="$"){const[v,j]=expand(src,i);i=j;const ps=v.split(/\s+/);ps.forEach((x,k)=>{if(k>0)push();if(x)add(x)});continue}
    if(c==="~"&&!cur&&(i+1>=n||"/ ".includes(src[i+1]))){add(HOME);i++;continue}
    add(c,c==="*"||c==="?");i++}
  push();
  const argv=[],redirs=[];
  for(let k=0;k<toks.length;k++){const t=toks[k];
    if(t.dup){redirs.push({dup:true});continue}
    if(t.op){const f=toks[++k];if(!f||f.op)throw new Error("syntax error near redirection");redirs.push({op:t.op,fd:t.fd,file:f.s});continue}
    if(t.glob){const g=globExpand(t.s);if(g.length){argv.push(...g);continue}}
    argv.push(t.s)}
  return{argv,redirs}}
function globExpand(p){const abs=p.startsWith("/"),segs=p.split("/").filter(Boolean);
  let cur=[{d:abs?"/":"",a:abs?"/":S.cwd}];
  for(const seg of segs){const nx=[];
    for(const c of cur){
      if(!/[*?]/.test(seg)){const a=c.a==="/"?"/"+seg:(c.a+"/"+seg);if(fs.get(norm(a)))nx.push({d:c.d+(c.d&&!c.d.endsWith("/")?"/":"")+seg,a:norm(a)});continue}
      const re=globRe(seg);
      for(const k of fs.kids(c.a)){const nm=k.slice(k.lastIndexOf("/")+1);if(nm.startsWith(".")&&!seg.startsWith("."))continue;if(re.test(nm))nx.push({d:c.d+(c.d&&!c.d.endsWith("/")?"/":"")+nm,a:k})}}
    cur=nx}
  return cur.map(c=>c.d).sort()}

/* ========== executor ========== */
function capture(src){const save=[sh.sink,sh.errSink];const buf=[];sh.sink=buf;sh.errSink=[];runLine(src);[sh.sink,sh.errSink]=save;return buf.join("")}
function runPipeline(text){
  const segs=splitTop(text,["|"]).reduce((acc,p)=>{acc.push(p.text);return acc},[]);
  // splitTop on "|" would break "||", handled earlier by runLine
  let inp=null,out="";
  for(let idx=0;idx<segs.length;idx++){
    const{argv,redirs}=words(segs[idx]);
    if(!argv.length&&!redirs.length)continue;
    const asg=argv.length&&/^[A-Za-z_]\w*=/.exec(argv[0]);
    if(asg&&argv.length===1){const k=argv[0].indexOf("=");sh.env[argv[0].slice(0,k)]=argv[0].slice(k+1);sh.code=0;continue}
    let hideErr=false,errFile=null,toOut=false,outFile=null,append=false;
    for(const r of redirs){if(r.dup)toOut=true;else if(r.op==="<"){const c=readFile(norm(r.file),"sh",r.file);if(c!==null)inp=c}else if(r.fd==="2"){if(r.file==="/dev/null")hideErr=true;else errFile=r.file}else{outFile=r.file;append=r.op===">>"}}
    const saveErr=sh.errSink,errs=[];if(hideErr||toOut||errFile)sh.errSink=errs;
    sh.code=0;let res;
    let cmd=COMMANDS[argv[0]];
    if(!cmd&&argv[0].includes("/")){const pth=norm(argv[0]),nd=fs.get(pth);
      if(!nd)cmd=()=>sh.e(`${argv[0]}: No such file or directory`);
      else if(!(nd.m&0o100))cmd=()=>sh.e(`${argv[0]}: Permission denied. Try chmod +x.`);
      else cmd=()=>runScript(pth)}
    if(!cmd){sh.e(`${argv[0]}: command not found. Run 'help' to see what this box has.`);sh.code=127;res=""}
    else{try{res=cmd(argv.slice(1),inp)??""}catch(x){sh.e(`${argv[0]}: ${x.message}`);res=""}}
    sh.errSink=saveErr;
    if(toOut)res=errs.join("")+res;if(errFile)writeFile(norm(errFile),errs.join(""),"sh");
    if(outFile!==null){writeFile(norm(outFile),res,"sh",append);res=""}
    inp=res;out=res}
  return out}
function runScript(p){const n=fs.get(p);if(!n||n.t==="d")return sh.e(`bash: ${p}: No such file or directory`);
  if(p===HOME+"/bin/errors.sh")S.ranScript=true;
  const buf=[],save=sh.sink;sh.sink=buf;for(const l of lines(n.c))if(l.trim()&&!l.startsWith("#"))runLine(l);sh.sink=save;return buf.join("")}
function runLine(src){
  const w=/^\s*while\s+read\s+(\w+)\s*;\s*do\s+(.*?)\s*;?\s*done\s*<\s*(\S+)(?:\s*(>>?)\s*(\S+))?\s*$/.exec(src);
  if(w){const c=readFile(norm(words(w[3]).argv[0]),"sh",w[3]);if(c===null)return;const buf=[],save=sh.sink;sh.sink=buf;
    for(const l of lines(c)){sh.env[w[1]]=l;runLine(w[2])}sh.sink=save;
    if(w[5])writeFile(norm(words(w[5]).argv[0]),buf.join(""),"sh",w[4]===">>");else sh.out(buf.join(""));return}
  const iff=/^\s*if\s+(.*?)\s*;\s*then\s+(.*?)\s*(?:;\s*else\s+(.*?)\s*)?;?\s*fi\s*$/.exec(src);
  if(iff){const save=sh.sink;sh.sink=[];runLine(iff[1]);sh.sink=save;if(sh.code===0)runLine(iff[2]);else if(iff[3])runLine(iff[3]);return}
  const f=/^\s*for\s+(\w+)\s+in\s+(.*?)\s*;\s*do\s+(.*?)\s*;?\s*done\s*$/.exec(src);
  if(f){const{argv}=words(f[2]);for(const v of argv){sh.env[f[1]]=v;runLine(f[3])}return}
  const chunks=splitTop(src,["&&","||",";"]);let prev=null;
  for(const c of chunks){
    if(prev==="&&"&&sh.code!==0){prev=c.sep;continue}
    if(prev==="||"&&sh.code===0){prev=c.sep;continue}
    if(c.text.trim())sh.out(runPipeline(c.text));
    prev=c.sep}}

export { sh, readFile, writeFile, walk, rx, globRe, opts, inputs, awkRun, sedRun, runPipeline, runScript, runLine };
