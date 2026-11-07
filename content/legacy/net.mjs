/* Networking track: from what an address is to diagnosing a dead connection.
   Interim: M1 converts this to content/missions/networking. */
import { netLive, resolver, DNS_OK } from '../../engines/shell/commands.js';
import { addMission, chapter } from './registry.mjs';

const ch = (name) => chapter('NET', name);
const net = (o) => addMission('NET', {
  kind: o.check ? 'auto' : 'answer', par: o.par || 1, goal: o.goal || 'Run: submit <answer>',
  sol: o.sol || `submit ${(o.answer || [''])[0]}`, ...o,
});

ch('Addresses');
net({ title: 'What an IP really is', from: 'Network', answer: ['32'], v: 'str(ipaddress.ip_address("10.0.0.1").max_prefixlen)', teaches: ['IP', 'bits', 'octet'],
  learn: ['Every device on a network has an address so that data can find it. An IPv4 address is a 32-bit number. For people it is written as four numbers from 0 to 255, each called an octet because it is 8 bits.', '10.40.30.21\nfour octets, 8 bits each'],
  brief: 'Four octets, 8 bits each. How many bits long is an IPv4 address?', hints: ['An octet is 8 bits.', '4 times 8.'], why: 'An address is just one 32-bit number written in a friendly way. All subnet maths follows from that.', job: 'Everything else in networking builds on this one fact.' });
net({ title: 'Binary to decimal', from: 'Network', answer: ['192'], v: 'str(0b11000000)', teaches: ['binary'],
  learn: ['Computers store numbers in binary, as ones and zeros. An octet has 8 bits, worth 128, 64, 32, 16, 8, 4, 2 and 1 from left to right. Add up the ones that are on.', '10000001 = 128 + 1 = 129\n00001010 = 8 + 2 = 10'],
  brief: 'What is the binary octet 11000000 in decimal?', hints: ['Only the first two bits are on.', '128 + 64'], why: 'Eight place values are all you need, and they come straight back when you read subnet masks.', job: 'Masks like 255.255.255.192 make sense once you can see the bits.' });
net({ title: 'Prefix and mask', from: 'Network', answer: ['255.255.255.192'], v: "str(ipaddress.ip_network('10.0.0.0/26').netmask)", teaches: ['prefix', 'mask', '/24'],
  learn: ['The first bits of an address name the network, and the rest name the host. The prefix says how many are network bits: /24 means 24. A mask is the same thing written as four numbers, with network bits on.', '/24 = 255.255.255.0\n/25 = 255.255.255.128\n/28 = 255.255.255.240'],
  brief: 'Write the dotted subnet mask for a /26.', hints: ['26 bits means 2 bits of the last octet.', '128 + 64'], why: 'The mask is the prefix written as four octets.', job: 'Older gear and many forms ask for masks.' });

ch('Subnets');
net({ title: 'Hosts in a subnet', from: 'Network', answer: ['254'], v: 'str(2**8-2)', teaches: ['hosts'],
  learn: ["What's left after the prefix is for hosts. With h host bits there are 2^h addresses, and each subnet loses 2: the network address and the broadcast address. A /31 link and a /32 single host are the exceptions.", '/28 leaves 4 host bits\n2^4 - 2 = 14 hosts'],
  brief: 'How many usable hosts does a /24 have?', hints: ['8 host bits.', '2^8 minus network and broadcast.'], why: 'Two addresses are reserved in each normal subnet.', job: 'The first number you memorise.' });
net({ title: 'Network and broadcast', from: 'Network', answer: ['10.4.7.192 10.4.7.223'], v: "str(ipaddress.ip_interface('10.4.7.201/27').network.network_address)+' '+str(ipaddress.ip_interface('10.4.7.201/27').network.broadcast_address)", goal: 'Run: submit <network> <broadcast>', teaches: ['block', 'network', 'broadcast'],
  learn: ['Block size is 256 minus the mask octet. The network address is the biggest multiple of the block size at or below your host. Broadcast is the last address in the block: network plus block size minus 1.', '10.0.0.77/28: block 16\nnetwork 10.0.0.64\nbroadcast 10.0.0.79'],
  brief: 'What are the network address and the broadcast address of 10.4.7.201/27? Give both, with a space between.', hints: ['/27 blocks go up in 32s. Largest multiple of 32 under 201.', 'Network plus 32, minus 1.'], why: 'The block size is 256 minus the mask octet, and networks start at its multiples. Broadcast is network plus block minus one.', job: 'Helps you spot a host set to an invalid address.' });
net({ title: 'Size it right', from: 'Network', answer: ['/25', '25'], v: "'/'+str(32-__import__('math').ceil(__import__('math').log2(120+2)))", teaches: ['size'],
  learn: ['Add 2 to the devices you need, then find the smallest block that fits. Usable hosts double with each step: 30, 62, 126, 254.', '40 devices need /26 (62 hosts)'],
  brief: "Guest Wi-Fi needs 120 devices. What's the smallest prefix that fits?", hints: ['Usable = 2^(32-prefix) - 2', '/26 gives 62.'], why: '/26 has 62 hosts and /25 has 126.', job: 'Sizing is the first decision in any VLAN plan.' });
net({ title: 'Private and special ranges', from: 'Network', answer: ['no'], v: "'yes' if ipaddress.ip_address('172.32.4.9').is_private else 'no'", goal: 'Run: submit yes  or  submit no', teaches: ['RFC 1918', '127.0.0.1'],
  learn: ['Private ranges, defined in RFC 1918, are free to use inside any network and never appear on the internet: 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16. 127.0.0.1 is loopback, meaning this machine. 100.64.0.0/10 is shared by ISPs.', '192.168.1.5   private\n8.8.8.8       public'],
  brief: 'Is 172.32.4.9 a private address? Careful: the 172 range only runs from 172.16 to 172.31.', hints: ['172.16.0.0/12 ends at 172.31.255.255.', '32 is past 31.'], why: 'The 172 private block is the one people misremember, because it stops at 172.31.', job: 'Knowing these ranges tells you at a glance if a log entry is internal.' });
net({ title: 'Carve one /24', from: 'Network', answer: ['10.40.60.192/27'], v: "str(list(ipaddress.ip_network('10.40.60.192/26').subnets(new_prefix=27))[0])", teaches: ['VLSM'],
  learn: ['Variable-length subnetting (VLSM) gives big groups big blocks. Allocate largest first and each block starts right after the last.', '10.0.0.0/24 for 60 and 20 hosts:\n10.0.0.0/26 then 10.0.0.64/27'],
  brief: "Split 10.40.60.0/24 for: engineering 100 hosts, support 50, finance 20. Allocate largest first, one after the other. What's the finance subnet?", hints: ['Engineering /25, support /26, finance /27.', 'Engineering ends at .127, support takes the next 64.'], why: 'Variable-length subnetting allocates largest first so blocks stay aligned.', job: 'How you stretch an address block across an office.' });
net({ title: 'One route for four', from: 'Network', answer: ['10.1.0.0/22'], v: "str(list(ipaddress.collapse_addresses([ipaddress.ip_network(f'10.1.{i}.0/24') for i in range(4)]))[0])", teaches: ['summaris'],
  learn: ['Neighbouring networks can share one shorter route if they fit one aligned block, which is called summarising. Two /24s make a /23, and four make a /22.', '10.2.4.0/24 + 10.2.5.0/24\n= 10.2.4.0/23'],
  brief: 'Write one route that covers exactly 10.1.0.0/24 to 10.1.3.0/24.', hints: ['Four /24s fit in two fewer prefix bits.', 'Their first 22 bits match.'], why: 'Summarising shrinks routing tables, as long as the block is aligned.', job: 'Smaller tables mean simpler, faster routing.' });

ch('Local network');
net({ title: 'MACs and ARP', from: 'Network', answer: ['mac', 'mac address'], goal: 'Run: submit <what ARP finds>', teaches: ['MAC', 'ARP'],
  learn: ['On a local network, frames are delivered by MAC address: a fixed hardware address on each network card, at layer 2. IP is layer 3. ARP connects them by asking the whole network "who has this IP?", and the owner replies.', 'Who has 10.0.0.9? Tell 10.0.0.5\n10.0.0.9 is at 52:54:00:3a:7e:21'],
  brief: 'A host knows the IP of its neighbour but needs one more address to actually send a frame. ARP finds it. What kind of address is that?', hints: ['It is a hardware address.', 'Three letters.'], why: 'IP gets a packet across networks, and the MAC gets it across the local wire. ARP is the bridge between them.', job: 'Duplicate IPs and bad switches show up as ARP problems.' });
net({ title: 'Local or via the gateway?', from: 'Network', answer: ['gateway'], v: "'gateway' if ipaddress.ip_address('10.40.31.9') not in ipaddress.ip_network('10.40.30.0/24') else 'local'", goal: 'Run: submit local  or  submit gateway', teaches: ['gateway'],
  learn: ['A host checks if the target shares its network bits. If yes it talks directly, and if not it sends to the gateway, the router for its subnet.', '10.0.0.5/24 to 10.0.0.9: local\n10.0.0.5/24 to 10.0.1.9: gateway'],
  brief: 'A host at 10.40.30.21/24 sends to 10.40.31.9. Is it local or via the gateway?', hints: ['Compare the network parts.', '/24 means the first three octets.'], why: 'A host compares network bits, then uses ARP for local targets or the gateway for the rest.', job: "Explains most 'can't reach it' tickets." });

ch('Transport');
net({ title: 'Ports and sockets', from: 'Support', answer: ['8080'], teaches: ['port', 'socket'],
  learn: ['An IP finds the machine, and a port finds the program on it. A socket is the pair, written with a colon. One server can run many services because each listens on its own port.', '10.40.10.80:443\n= machine 10.40.10.80, port 443'],
  brief: 'A log line says the app is at 10.40.10.11:8080. Which port is the program listening on?', hints: ['It is after the colon.', 'The part before the colon is the machine.'], why: 'IP plus port identifies one service on one machine.', job: 'Every connection you debug is described this way.' });
net({ title: 'The TCP handshake', from: 'Network', answer: ['syn-ack', 'synack', 'syn ack'], teaches: ['SYN', 'SYN-ACK', 'ACK', 'TCP'],
  learn: ['TCP sets up a connection before sending data, with three messages. The client sends SYN, the server answers SYN-ACK, and the client finishes with ACK.', '-> SYN\n<- SYN-ACK\n-> ACK'],
  brief: 'A client sends SYN to a healthy server. What does the server send back?', hints: ['It has to acknowledge and also start its own side.', 'Two words joined by a dash.'], why: 'The handshake proves both sides can hear each other. A SYN with no reply usually means a firewall.', job: 'Connection timeouts are diagnosed by which step of this fails.' });
net({ title: 'TCP or UDP?', from: 'Network', answer: ['udp'], goal: 'Run: submit tcp  or  submit udp', teaches: ['UDP'],
  learn: ['TCP sets up a connection and retries, which is reliable but slower. UDP just sends, which is fast and simple, and the application handles any loss.', 'Video calls often use UDP\nFile transfer uses TCP'],
  brief: 'Normal DNS queries use which transport first?', hints: ['Short question, short answer, no handshake.'], why: 'DNS uses UDP for speed and falls back to TCP for large answers.', job: 'Firewall rules for DNS need both.' });
net({ title: 'Ports you must know', from: 'Support', answer: ['443'], teaches: ['22', '53', '80'],
  learn: ['Well-known ports are shared conventions. 22 is SSH, 25 is mail, 53 is DNS, 80 is HTTP and 3389 is Windows remote desktop. Secure web has its own port.', 'HTTP uses TCP 80\nSSH uses TCP 22'],
  brief: 'Which TCP port does HTTPS use by default?', hints: ['HTTP is 80.'], why: 'Well-known ports are conventions that firewalls and clients assume.', job: "You'll read port numbers all day." });

ch('Services');
net({ title: 'DNS records', from: 'Network', answer: ['196.41.0.20'], teaches: ['DNS', 'A', 'CNAME', 'grep', 'cat'],
  learn: ['DNS turns names into addresses. An A record gives an IPv4 address, AAAA an IPv6 one, CNAME points to another name, MX says where mail goes, and TXT holds notes. cat prints a file and grep finds lines in it.', 'blog CNAME host\nhost A 1.2.3.4\n\ngrep host zone.txt'],
  brief: 'In ~/net/zone.txt, what IP does www finally resolve to?', hints: ['www is a CNAME for edge.', "Then find edge's A record."], why: 'A CNAME points to a name, so the resolver looks that name up again.', sol: 'cat ~/net/zone.txt', job: 'CDNs and hosting setups chain these.' });
net({ title: 'Follow a DNS lookup', from: 'Support', par: 3, goal: 'Fix /etc/resolv.conf so dig app.whiteraven.example answers.', check() { return resolver() === DNS_OK; }, teaches: ['dig', 'resolv.conf', 'sed', '-i'],
  learn: ['/etc/resolv.conf says which DNS server to ask, and dig asks it. A timeout means no server answered, which is different from NXDOMAIN, which means it answered that the name does not exist. To change a word in a file: sed -i s/old/new/ file.', "cat /etc/resolv.conf\ndig example.test\nsed -i 's/1.1.1.1/8.8.8.8/' settings.conf"],
  brief: "Staff can't reach app.whiteraven.example and dig times out. The server list is ~/net/servers.txt.", hints: ['Compare the nameserver line with the list.', 'sed -i works well here.'], why: "A timeout means no server answered, and NXDOMAIN means it answered that the name doesn't exist. They're different faults.", sol: "cat ~/net/servers.txt\nsed -i 's/10.40.10.99/10.40.10.53/' /etc/resolv.conf\ndig app.whiteraven.example", job: "'The internet is down' is often only DNS." });
net({ title: 'How DHCP hands out addresses', from: 'Network', answer: ['request'], goal: 'Run: submit <the missing step>', teaches: ['DHCP', 'DORA'],
  learn: ['DHCP gives a device its IP, gateway and DNS servers automatically, in four steps known as DORA: Discover, Offer, Request, Acknowledge.', 'Discover  anyone there?\nOffer     have this address\nRequest   yes please\nAck       it is yours'],
  brief: 'A laptop joins Wi-Fi. The order is Discover, Offer, ____, Acknowledge. What is the missing step?', hints: ['DORA.', 'The client now asks for the offered address.'], why: 'Two broadcasts and two replies, so a laptop with no address at all can still get one.', job: 'A 169.254 address means this conversation failed.' });

ch('Routing');
net({ title: 'Read a routing table', from: 'Network', answer: ['10.40.0.4'], goal: 'Run: submit <next hop IP>', teaches: ['longest prefix'],
  learn: ['When several routes match, the router picks the longest prefix, meaning the most specific one. The default route only wins when nothing else matches.', 'to 10.0.0.9:\n10.0.0.0/8 and 10.0.0.0/24 match\n/24 wins'],
  brief: "~/net/routes.txt is a router's table. A packet is going to 10.40.30.140.", hints: ['The longest matching prefix wins.', '10.40.30.192/26 starts at .192.'], why: '.140 is in 10.40.30.128/25 but not in .192/26, so longest match gives 10.40.0.4.', sol: 'cat ~/net/routes.txt\nsubmit 10.40.0.4', job: 'Explains why traffic took an unexpected path.' });
net({ title: 'The PC with no internet', from: 'Support', par: 5, goal: 'Fix the gateway, run netplan apply, confirm with ping -c 1 1.1.1.1', check() { return netLive().gw === '10.40.30.1'; }, teaches: ['ip', 'netplan', 'ping', 'addr', 'route', '-c'],
  learn: ['A gateway must be on your own subnet. ip addr shows your address and ip route shows your gateway. Config edits only take effect when applied. ping -c 1 tests if something answers.', 'ip addr\nip route\nnetplan apply\nping -c 1 1.1.1.1'],
  brief: "This box is 10.40.30.21 and can't reach 1.1.1.1. The gateway is always the first host on a VLAN. The config is /etc/netplan/01-office.yaml.", hints: ['Compare ip addr with ip route.', 'Fix the via line, then netplan apply.'], why: "A gateway must be on your own subnet. Editing a file changes nothing until it's applied.", sol: "ip addr\nip route\nsed -i 's/10.40.3.1/10.40.30.1/' /etc/netplan/01-office.yaml\nnetplan apply\nping -c 1 1.1.1.1", job: 'Check address, then route, then DNS.' });

ch('Tools');
net({ title: 'Read ping', from: 'SRE', answer: ['25', '25%'], goal: 'Run: submit <loss percent>', teaches: ['ICMP', 'TTL', 'loss'],
  learn: ['ping sends ICMP echo requests and times the replies. Look at three things: time (delay), TTL (hops left before the packet is dropped), and loss (how many never came back).', '64 bytes from 10.0.0.9: ttl=62 time=3.1 ms\n4 packets transmitted, 4 received, 0% packet loss'],
  brief: 'A user says the app feels unreliable. In ~/net/ping.txt, what percentage of packets were lost?', hints: ['It is in the last line.', 'icmp_seq=3 never came back.'], why: 'Loss hurts more than delay, because TCP slows right down when packets go missing.', sol: 'cat ~/net/ping.txt', job: 'Ping is the first tool anyone reaches for.' });
net({ title: 'Read traceroute', from: 'SRE', answer: ['5'], goal: 'Run: submit <hop number>', teaches: ['traceroute'],
  learn: ['traceroute lists each hop with its delay. A jump that stays high on later hops shows where the delay begins.', 'hop 2  5 ms\nhop 3  90 ms\nhop 4  92 ms\ndelay begins at hop 3'],
  brief: 'Using ~/net/traceroute.txt, at which hop does latency jump?', hints: ['Look for the big step, not the total.', 'Latency persists to later hops.'], why: 'A jump that carries on to later hops marks a real long link or congestion.', sol: 'cat ~/net/traceroute.txt', job: 'Lets you show your ISP exactly where the problem is.' });
net({ title: 'Who is listening?', from: 'SRE', answer: ['postgres'], goal: 'Run: submit <program name>', teaches: ['ss', '-t', '-u', '-l', '-p', '-n'],
  learn: ['ss -tulpn lists everything waiting for connections: -t TCP, -u UDP, -l listening, -p with the process, -n with numbers. An address of 127.0.0.1 means only this machine can reach it.', 'ss -tulpn'],
  brief: 'Which program on this server is only reachable from the machine itself, on port 5432?', hints: ['Run ss -tulpn.', 'Look for 127.0.0.1:5432.'], why: 'A service bound to 127.0.0.1 cannot be reached from outside, which is the usual cause of "connection refused".', sol: 'ss -tulpn', job: 'The first check when a service cannot be reached.' });
net({ title: 'Talk HTTP by hand', from: 'SRE', answer: ['503'], goal: 'Run: submit <status code>', teaches: ['curl', '-I'],
  learn: ['curl fetches a URL, and curl -I asks for only the headers. The first line has the status: 2xx worked, 3xx redirects, 4xx is the client\'s fault, 5xx is the server\'s fault.', 'curl -I https://example.test\nHTTP/1.1 200 OK'],
  brief: 'What status does https://app.whiteraven.example return right now?', hints: ['curl -I shows just the headers.', 'The number on the first line.'], why: 'The status tells you whose fault it is before you read anything else, and 503 means the server knows it is unavailable.', sol: 'curl -I https://app.whiteraven.example', job: 'curl -I is how you check a site without a browser.' });

ch('Edge');
net({ title: 'Read the NAT table', from: 'Network', answer: ['40002'], teaches: ['NAT'],
  learn: ['NAT shares one public IP. It maps each inside address and port to an outside port, and the table shows the mapping.', '10.0.0.5:4000 -> 1.2.3.4:50001'],
  brief: 'In ~/net/nat-table.txt, which outside port does guest device 10.40.40.17 appear from?', hints: ['grep the inside address.', 'The outside column is after the colon.'], why: 'NAT shares one public IP by mapping inside address and port pairs to outside ports.', sol: 'grep 10.40.40.17 ~/net/nat-table.txt', job: 'Essential when tracing who made a connection.' });
net({ title: 'First match wins', from: 'Network', answer: ['20'], goal: 'Run: submit <rule number that decides>', teaches: ['Firewall'],
  learn: ['Firewalls read rules from the top and stop at the first match. Lower rules never see that packet.', '1 deny from A\n2 permit from any\nA is denied by rule 1'],
  brief: 'A guest laptop at 10.40.40.7 opens TCP 443 to 10.40.20.5. Rules are in ~/net/fw-rules.txt.', hints: ['Read from the top and stop at the first full match.', 'Rule 30 would allow it, but something comes first.'], why: 'Firewalls stop at the first match, so the finance deny must sit above the general permit.', sol: 'cat ~/net/fw-rules.txt\nsubmit 20', job: 'Network separation depends on rule order.' });
net({ title: 'TLS at a glance', from: 'SRE', answer: ['dec 14', 'dec 14 2026', '2026-12-14'], goal: 'Run: submit <month and day>, for example: submit dec 14', teaches: ['TLS', 'certificate', 'openssl'],
  learn: ['TLS encrypts traffic and proves who the server is, using a certificate with an expiry date. openssl s_client shows it. notAfter is the moment it stops being valid, and browsers then refuse the site.', 'openssl s_client -connect example.test:443\nnotAfter=Jan  9 23:59:59 2027 GMT'],
  brief: 'In ~/net/cert.txt, when does the certificate for app.whiteraven.example expire?', hints: ['Look for notAfter.', 'grep notAfter ~/net/cert.txt'], why: 'A certificate is only trusted until its expiry date, so expiry is a calendar problem that looks like an outage.', sol: 'grep notAfter ~/net/cert.txt', job: 'Expired certificates still take down major sites every year.' });
net({ title: 'IPv6 basics', from: 'Network', answer: ['2001:db8::1'], v: "str(ipaddress.ip_address('2001:0db8:0000:0000:0000:0000:0000:0001'))", teaches: ['IPv6', '::'],
  learn: ['IPv6 addresses have 128 bits, written as eight groups. To shorten one, drop the leading zeros in each group and replace one run of all-zero groups with ::. Subnets are usually /64, and fe80:: addresses are link-local.', '2001:0db8:0001:0000:0000:0000:0000:0002\n= 2001:db8:1::2'],
  brief: 'Shorten 2001:0db8:0000:0000:0000:0000:0000:0001 as far as it goes.', hints: ['0db8 becomes db8.', 'The six zero groups become ::'], why: 'Only one :: is allowed per address, or nobody could tell how many zeros each one hides.', job: 'Cloud providers increasingly hand out IPv6 first.' });

ch('Putting it together');
net({ title: 'How long will it take?', from: 'SRE', answer: ['80'], v: 'str(int(1000*8/100))', goal: 'Run: submit <seconds>', teaches: ['Mbps'],
  learn: ['Files are measured in bytes and links in bits, usually Mbps. Multiply bytes by 8, then divide by the link speed.', '500 MB = 4000 Mb\non 50 Mbps: 80 s'],
  brief: 'How many seconds to send 1 GB (1000 MB) over a 100 Mbps link at full speed?', hints: ['Bytes to bits: multiply by 8.', '8000 megabits at 100 per second.'], why: 'Files are sized in bytes and links in bits, which is why speeds look eight times slower.', job: 'Backup and migration windows come from this sum.' });
net({ title: 'Capstone: the troubleshooting ladder', from: 'CTO', reasoned: true, answer: ['dns'], goal: 'Run: submit <the layer at fault>: link, gateway, internet or dns', teaches: ['capstone'],
  learn: ['Nothing new. Work up the ladder and stop at the first thing that fails: is the link up? Does the gateway answer? Does an outside IP answer? Do names resolve? Each pass rules out everything below it.', 'ip addr      link\nping gateway local\nping 1.1.1.1 internet\ndig name     dns'],
  brief: 'A laptop "has no internet". Sara ran the checks and saved them in ~/net/incident.txt. Which layer is actually broken?', hints: ['Read from the top and find the first failure.', 'Pings to an IP worked, so what is left?'], why: 'Going up the ladder in order means every passed step rules out a whole class of faults, so you find the broken layer instead of guessing.', sol: 'cat ~/net/incident.txt', job: 'This is the method behind every network ticket you will ever close.' });
