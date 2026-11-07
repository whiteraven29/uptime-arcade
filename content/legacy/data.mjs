/* Fictional company data and shared fixtures. Interim: M1 converts this to content/fixtures. */
import { rng, pad, joinL, F, HOME, HOST } from '../../engines/fs/index.js';

/* ========== company data (fictional) ========== */
const CO="Whiteraven";
const DATA=(()=>{
  const R=rng(2031),n=k=>Math.floor(R()*k),pick=a=>a[n(a.length)];
  const ips=Array.from({length:24},(_,i)=>(i%2?"198.51.100.":"203.0.113.")+(10+i*7));
  const paths=["/v1/orders","/v1/orders","/v1/orders","/v1/invoices","/v1/users","/v1/status","/health","/health","/v1/search","/v1/upload"];
  const api=[];
  for(let i=0;i<1600;i++){const t=new Date(Date.UTC(2026,9,14,6,0,i*19));
    const p=pick(paths),st=R()<.04?500:R()<.06?404:R()<.05?429:200,ms=p==="/v1/search"?300+n(1500):20+n(420);
    const ip=i%5===0?ips[3]:i%11===0?ips[8]:pick(ips);
    api.push([t.toISOString().slice(0,19),ip,p==="/v1/upload"?"POST":"GET",p,st,ms,200+n(9000)])}
  const svc=["payments","auth","search","mailer","billing"],lv=["INFO","INFO","INFO","INFO","WARN","ERROR"];
  const app=[];
  for(let i=0;i<900;i++){const l=i%97===0?"FATAL":pick(lv),s=pick(svc);app.push(`2026-10-14 ${pad(6+Math.floor(i/60))}:${pad(i%60)}:${pad(n(60))} ${l} ${s} ${l==="INFO"?"handled":"retrying"} order=${1000+n(240)}`)}
  const deploys=[];const authors=["amina","joel","sara","peter"];
  for(let i=0;i<120;i++){const s=pick(svc);deploys.push([`2026-${pad(7+i%4)}-${pad(1+i%27)}`,s,`1.${n(9)}.${n(20)}`,pick(authors),R()<(s==="search"?.4:.08)?"failed":"ok",30+n(400)])}
  const plans=["free","starter","pro","enterprise"],price={free:0,starter:25,pro:99,enterprise:499},cc=["TZ","KE","UG","RW","ZA","NG"];
  const cust=[];
  for(let i=1;i<=140;i++){const p=plans[i%7===0?3:i%3===0?2:i%2===0?1:0];cust.push([`C${1000+i}`,`Customer ${i}`,p,cc[n(6)],price[p],`${pad(1+n(28))}/${pad(1+n(12))}/${2023+n(4)}`])}
  const roles=["web","db","cache","worker"],regions=["dar","nbo","jnb"];
  const servers=[];
  for(let i=1;i<=40;i++)servers.push([`srv-${String(i).padStart(2,"0")}`,pick(regions),pick(roles),10+n(90),[8,16,32,64][n(4)],25+n(75),1+n(400)]);
  const count=(a,f)=>a.filter(f).length;
  const uniq=a=>[...new Set(a)];
  const top=m=>Object.entries(m).sort((x,y)=>y[1]-x[1]||(x[0]<y[0]?-1:1))[0][0];
  const tally=(a,k,v=()=>1)=>{const m={};for(const x of a)m[k(x)]=(m[k(x)]||0)+v(x);return m};
  return{api,app,deploys,cust,servers,count,uniq,top,tally,svc};
})();
const apiLog=joinL(DATA.api.map(r=>r.join(" ")));
const appLog=joinL(DATA.app);
const deploysCsv="date,service,version,author,status,seconds\n"+joinL(DATA.deploys.map(r=>r.join(",")));
const customersCsv="id,name,plan,country,mrr,signup\n"+joinL(DATA.cust.map(r=>r.join(",")));
const serversCsv="host,region,role,cpu_pct,ram_gb,disk_pct,uptime_days\n"+joinL(DATA.servers.map(r=>r.join(",")));
F(HOME+"/README",`${CO} (a fictional cloud company).
You start as a Noob. Clear missions and rise to Archmage.
Run 'brief' for the open ticket and 'tickets' for the queue.

Offices and VLANs
  VLAN 10  Servers      10.40.10.0/24
  VLAN 20  Finance      10.40.20.0/24
  VLAN 30  Engineering  10.40.30.0/24
  VLAN 40  Guest Wi-Fi  10.40.40.0/24
`);
F(HOME+"/logs/api-access.log",apiLog);F(HOME+"/logs/app.log",appLog);
F(HOME+"/data/deploys.csv",deploysCsv);F(HOME+"/data/customers.csv",customersCsv);F(HOME+"/data/servers.csv",serversCsv);
F(HOME+"/inbox/-handover.txt","The on-call rota is in the 'week 44' folder. It is hidden so nobody edits it by accident.\n");
F(HOME+"/inbox/week 44/notes.txt","Last week's on-call was peter.\n");
F(HOME+"/inbox/week 44/.rota","On call this week: sara\n");
for(const n of ["web","db","cache","worker","edge"])F(`${HOME}/reports/${n}.TXT`,`Capacity report for ${n}\n`);
F(HOME+"/reports/q3 summary.TXT","Quarter summary\n");F(HOME+"/reports/archive.txt","Older report, leave it.\n");
for(let i=1;i<=7;i++)F(`${HOME}/archive/2026-0${i}/app.log`,"archived\n");
F(HOME+"/archive/2026-03/app.log.gz","binary\n");F(HOME+"/archive/2026-05/deploy.log","archived\n");F(HOME+"/archive/readme.txt","Monthly logs.\n");
for(const p of ["a.tmp","b.o","c.tmp","sub/d.tmp","sub/e.o","sub/keep.txt"])F(`${HOME}/build/${p}`,"x\n");
F(HOME+"/conf/nginx-comments.conf",`# edge config

worker_processes 4;
# keep alive for mobile clients
keepalive_timeout 65;

gzip on;
`);
F(HOME+"/conf/app-old.env","PORT=8080\nWORKERS=4\nCACHE_TTL=60\nLOG_LEVEL=info\nREGION=dar\n");
F(HOME+"/conf/app-new.env","PORT=8080\nWORKERS=4\nCACHE_TTL=600\nLOG_LEVEL=info\nREGION=dar\n");
F(HOME+"/conf/endpoints.conf","upstream=api.old-host.example\nmetrics=stats.old-host.example\ncdn=cdn.old-host.example\n");
F(HOME+"/conf/windows.txt","alpha\r\nbravo\r\ncharlie\r\n");
F(HOME+"/data/hosts.txt","srv-01\nsrv-02\nsrv-03\nsrv-04\n");
F(HOME+"/data/names.txt","payments\nauth\nsearch\n");F(HOME+"/data/owners.txt","amina\njoel\nsara\n");
F("/etc/netplan/01-office.yaml",`network:
  version: 2
  ethernets:
    eth0:
      addresses: [10.40.30.21/24]
      routes:
        - to: default
          via: 10.40.3.1
      nameservers:
        addresses: [10.40.10.53]
`);
F("/etc/resolv.conf","# managed by platform team\nnameserver 10.40.10.99\n");
F("/etc/hostname",HOST+"\n");
F(HOME+"/oncall/README","Shift logs land here.\n");
F(HOME+"/net/servers.txt","DHCP    10.40.10.52\nDNS     10.40.10.53\nNTP     10.40.10.54\nApp     10.40.10.80\n");
F(HOME+"/net/routes.txt",`default via 10.40.0.1 dev eth0
10.40.0.0/16 via 10.40.0.2 dev eth1
10.40.30.0/24 via 10.40.0.3 dev eth2
10.40.30.128/25 via 10.40.0.4 dev eth3
10.40.30.192/26 via 10.40.0.5 dev eth4
`);
F(HOME+"/net/fw-rules.txt",`# rule  action  proto  source          destination      port
10      permit  udp    10.40.40.0/24   10.40.10.53/32   53
20      deny    ip     10.40.40.0/24   10.40.20.0/24    any
30      permit  tcp    10.40.40.0/24   any              443
40      permit  ip     10.40.0.0/16    any              any
50      deny    ip     any             any              any
`);
F(HOME+"/net/nat-table.txt",`proto  inside           outside            state
tcp    10.40.30.21:51022  196.41.0.9:51022   ESTABLISHED
tcp    10.40.30.44:51877  196.41.0.9:40001   ESTABLISHED
udp    10.40.30.21:5353   196.41.0.9:5353    UNREPLIED
tcp    10.40.40.17:33210  196.41.0.9:40002   TIME_WAIT
`);
F(HOME+"/net/zone.txt",`$TTL 300
@       IN  SOA   ns1.whiteraven.example. ops.whiteraven.example. ( 2026110601 )
@       IN  NS    ns1.whiteraven.example.
@       IN  MX 10 mail1.whiteraven.example.
@       IN  MX 20 mail2.whiteraven.example.
www     IN  CNAME edge.whiteraven.example.
edge    IN  A     196.41.0.20
mail1   IN  A     196.41.0.25
mail2   IN  A     196.41.0.26
`);
F(HOME+"/net/traceroute.txt",`traceroute to 196.41.0.20, 30 hops max
 1  10.40.30.1    1.1 ms
 2  10.40.0.1     1.9 ms
 3  100.64.8.1    4.2 ms
 4  100.64.9.5    6.0 ms
 5  196.41.1.1  148.7 ms
 6  196.41.0.20 151.3 ms
`);
F(HOME+"/net/lb-status.txt",`backend     address          health   active
web-a       10.40.10.11:8080 up       212
web-b       10.40.10.12:8080 up       208
web-c       10.40.10.13:8080 down     0
web-d       10.40.10.14:8080 up       644
`);
F(HOME+"/switch/core-sw1.cfg",(()=>{const o=["hostname core-sw1","!"];
  const tr={1:"10,20,30,40",2:"10,20,30,40",3:"10,20,130,40",4:"30,40",24:"10,20,30,40"};
  for(let i=1;i<=24;i++){o.push(`interface Gi1/0/${i}`);
    if(tr[i])o.push(" description uplink"," switchport mode trunk",` switchport trunk allowed vlan ${tr[i]}`);
    else o.push(" description desk port"," switchport mode access",` switchport access vlan ${i%2?30:40}`);o.push("!")}
  return o.join("\n")+"\n"})());

export { CO, DATA, apiLog, appLog, deploysCsv, customersCsv, serversCsv };
