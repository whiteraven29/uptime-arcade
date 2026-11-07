/* Shell track: from "what is a folder" to a real script. Interim: M1 converts this to content/missions/shell. */
import { S } from '../../engines/host.js';
import { fs, HOME, joinL, lines } from '../../engines/fs/index.js';
import { walk } from '../../engines/shell/index.js';
import { DATA, customersCsv } from './data.mjs';
import { addMission, ans, chapter } from './registry.mjs';

const sh = (o) => addMission('SH', { kind: o.check ? 'auto' : 'answer', par: 1, ...o });
const ch = (name) => chapter('SH', name);
const A = DATA.api, ST = 4, MS = 5, PA = 3, IP = 1;
const by = DATA.tally, top = DATA.top, cnt = DATA.count;
const fatal = DATA.app.filter((l) => / FATAL /.test(l));

ch('Getting around');
sh({ title: 'Where am I?', from: 'Support', answer: [HOME], teaches: ['pwd', 'ls'],
  learn: ["The shell is a program that runs what you type. Files live in folders, folders sit inside folders, and it all forms a tree that starts at / (the root). You are always standing in one folder. pwd prints that folder's full path, and ls lists what's in it.", '$ pwd\n/home/amina\n$ ls\nphotos  notes.txt'],
  brief: "You've just logged in to Whiteraven's training server for the first time. Before touching anything, find out where you are.", goal: 'Run pwd, then: submit <the path it printed>',
  hints: ['Type pwd and press Enter.', 'Then type submit followed by what it printed.'], why: 'pwd answers "where am I?". Every path you type without a leading / is worked out from that folder.', sol: 'pwd', job: 'The first thing to check when a command says "No such file".' });
sh({ title: 'Moving between folders', from: 'Support', par: 3, teaches: ['cd', '..', '~'], check() { return S.cwd === HOME + '/logs'; },
  learn: ['cd changes folder. A path starting with / is absolute: it works from anywhere. Any other path is relative to where you are. .. means the folder above, and ~ means your home folder.', 'cd /etc        # absolute\ncd ~           # home\ncd photos      # relative\ncd ..          # up one'],
  brief: 'Take the tour. Visit /etc using an absolute path, come home with ~, then step into logs using a relative path.', goal: 'End up in ~/logs. It finishes by itself when you get there.',
  hints: ['cd /etc gets you the first stop.', 'cd ~ then cd logs. Run pwd any time you feel lost.'], why: 'Absolute paths start at / and work anywhere. Relative paths start from your current folder and are shorter.', sol: 'cd /etc\ncd ~\ncd logs', job: 'You move around servers like this all day.' });
sh({ title: 'Read the welcome file', from: 'Support', answer: ['40'], teaches: ['cat', 'head', 'tail'],
  learn: ['cat prints a whole file. head shows the first lines and tail shows the last ones. Add -3 to choose how many.', 'cat notes.txt\nhead -3 notes.txt\ntail -1 notes.txt'],
  brief: '~/README lists the office VLANs, and guest Wi-Fi is on the last line. Which VLAN number is it?', goal: 'Run: submit <the VLAN number>',
  hints: ['tail -1 prints just the last line.', 'The number comes right after the word VLAN.'], why: "head and tail let you peek at a file without printing all of it, which matters when a log has a million lines.", sol: 'tail -1 ~/README', job: 'tail is the first thing you run on any log file.' });
sh({ title: 'The file nobody can open', from: 'Support', par: 3, answer: ['sara'], teaches: ['ls', '-a'],
  learn: ['Quote names with spaces, and put ./ or a path before names that start with a dash. Names starting with a dot are hidden, and ls -a shows them.', "cat './my file.txt'\nls -a ~/projects"],
  brief: 'Find who is on call this week. The handover note in ~/inbox has a name that trips up cat, and the rota itself is hidden.', goal: 'Run: submit <name>',
  hints: ['Names starting with a dash look like options. Put a path in front.', 'Quote names with spaces. ls -a shows dotfiles.'], why: 'The shell splits on spaces, and programs read a leading dash as an option. Quoting and a path prefix fix both. Dotfiles are only hidden from plain ls.', sol: "cat ~/inbox/-handover.txt\nls -a ~/inbox/'week 44'\ncat ~/inbox/'week 44'/.rota", job: 'Backups and uploads produce names like this all the time.' });

ch('Files');
sh({ title: 'Set up a workspace', from: 'Platform', par: 2, teaches: ['mkdir', '-p', 'touch'], check() { return !!fs.get(HOME + '/work/today/notes.txt'); },
  learn: ['mkdir makes a folder, and -p also makes any missing parents. touch creates an empty file.', 'mkdir -p ~/trips/2026/june\ntouch ~/trips/2026/june/plan.txt'],
  brief: "You'll need somewhere to keep your notes.", goal: 'Create the folder ~/work/today with an empty file notes.txt inside it.',
  hints: ['Two folders are missing, so mkdir needs -p.', 'touch ~/work/today/notes.txt'], why: "mkdir -p creates the whole chain and doesn't complain if a folder is already there, so it's safe to run twice.", sol: 'mkdir -p ~/work/today\ntouch ~/work/today/notes.txt', job: 'Setup scripts use mkdir -p because it can be run again safely.' });
sh({ title: 'Copy, move, rename', from: 'Platform', par: 2, teaches: ['cp', 'mv'], fixtures: { 'desk/draft.txt': 'Quarterly capacity draft\n' },
  check() { return !!fs.get(HOME + '/desk/backup.txt') && !!fs.get(HOME + '/desk/final.txt') && !fs.get(HOME + '/desk/draft.txt'); },
  learn: ["cp copies a file and leaves the original. mv moves it, and moving to a new name in the same folder is how you rename. Linux has no separate rename command.", 'cp cat.jpg cat-copy.jpg\nmv cat.jpg pictures/\nmv old.txt new.txt'],
  brief: "~/desk/draft.txt is ready. Keep a safety copy called backup.txt, then rename the draft to final.txt.", goal: 'Leave ~/desk with backup.txt and final.txt, and no draft.txt.',
  hints: ['Copy first, while draft.txt still exists.', 'mv ~/desk/draft.txt ~/desk/final.txt'], why: "mv is both move and rename, because a file's name is just part of its path.", sol: 'cp ~/desk/draft.txt ~/desk/backup.txt\nmv ~/desk/draft.txt ~/desk/final.txt', job: 'Copy before you change: it is the cheapest rollback there is.' });
sh({ title: 'Delete with care', from: 'SRE', par: 2, teaches: ['rm', '-r'], fixtures: { 'desk/old.log': 'stale\n', 'desk/tmp/a.txt': 'x\n', 'desk/tmp/b.txt': 'x\n', 'desk/keep.txt': 'Important. Leave this one.\n' },
  check() { return !fs.get(HOME + '/desk/old.log') && !fs.get(HOME + '/desk/tmp') && !!fs.get(HOME + '/desk/keep.txt'); },
  learn: ["rm deletes a file. rm -r deletes a folder and everything inside it. There's no undo and no recycle bin, so look with ls first.", 'ls ~/old\nrm ~/old/notes.txt\nrm -r ~/old'],
  brief: 'Clear ~/desk/old.log and the whole ~/desk/tmp folder. keep.txt must survive. If you delete it by mistake, press Leave and reopen this mission to restore the files.', goal: 'Remove old.log and tmp, and keep keep.txt.',
  hints: ['rm on its own refuses folders.', 'rm -r ~/desk/tmp'], why: 'rm is permanent, so name exactly what you mean. Careless rm -r is how people lose production data.', sol: 'rm ~/desk/old.log\nrm -r ~/desk/tmp', job: 'Everyone gets one rm -r story. Make sure yours is small.' });

ch('Counting and finding');
sh({ title: 'How much traffic today?', from: 'Support', answer: ans(A.length), teaches: ['wc', '-l'],
  learn: ['wc counts things. -l counts lines, and logs usually hold one event per line.', 'wc -l notes.txt'],
  brief: 'Support asks how many API requests are in ~/logs/api-access.log.', goal: 'Run: submit <count>',
  hints: ['wc counts lines.', 'wc -l prints the count and the file name.'], why: 'One line per request means counting lines counts requests.', sol: 'wc -l ~/logs/api-access.log', job: "Quick size checks tell you what you're dealing with before deeper work." });
sh({ title: 'Find the word', from: 'SRE', answer: ['7'], teaches: ['grep', '-i', '-n'],
  learn: ['grep prints the lines that contain a pattern. -i ignores upper and lower case, and -n shows each line number.', "grep timeout server.log\ngrep -in 'error' server.log"],
  brief: 'Which line of ~/conf/nginx-comments.conf turns on gzip? Someone may have typed it in capitals, so ignore case.', goal: 'Run: submit <line number>',
  hints: ['grep -i ignores case.', 'Add -n, as in grep -in. The number before the colon is the line.'], why: 'grep is the search box of the command line. -n tells you where to go and -i stops capitals hiding a match.', sol: 'grep -in gzip ~/conf/nginx-comments.conf', job: 'You will run grep more than any other command.' });
sh({ title: 'Ignore the health checks', from: 'SRE', answer: ans(cnt(A, (r) => r[PA] !== '/health')), teaches: ['-v', '-c'],
  learn: ['grep -c prints how many lines matched instead of the lines. grep -v flips it, keeping the lines that do NOT match. Flags can be joined, as in -vc.', "grep -c 'timeout' server.log\ngrep -v 'DEBUG' server.log"],
  brief: 'Load balancer checks are noise. How many requests in ~/logs/api-access.log are NOT for /health?', goal: 'Run: submit <count>',
  hints: ['grep -v inverts the match.', 'Add -c to count.'], why: 'Removing known noise first is how you make logs readable.', sol: "grep -vc '/health' ~/logs/api-access.log", job: 'Filtering health checks is standard in every log query.' });

ch('Pipes');
sh({ title: 'Your first pipe', from: 'SRE', answer: [DATA.app[0].split(' ')[3]], teaches: ['|'],
  learn: ['A pipe | sends the output of one command into the next. Small tools chained together do big jobs, and this is the core idea of the shell.', 'grep cat pets.txt | head -2\ngrep dog pets.txt | wc -l'],
  brief: 'Which service wrote the very first FATAL line in ~/logs/app.log? The service is the 4th word on the line.', goal: 'Run: submit <service>',
  hints: ['grep FATAL finds them all.', 'Pipe into head -1 to keep only the first.'], why: 'Each command does one small job, and the pipe joins them. grep picks the lines, head keeps the first.', sol: 'grep FATAL ~/logs/app.log | head -1', job: 'Almost every useful one-liner has a pipe in it.' });
sh({ title: 'Save the output', from: 'SRE', par: 2, teaches: ['>', '>>'], check() { const f = fs.get(HOME + '/incident.txt'); return !!f && f.c === joinL(fatal) + fatal.length + '\n'; },
  learn: ['> writes output to a file, replacing what was there. >> adds to the end instead. 2>/dev/null throws error messages away.', "grep cat pets.txt > cats.txt\ngrep -c cat pets.txt >> cats.txt\nls missing 2>/dev/null"],
  brief: 'The incident channel wants the FATAL lines from ~/logs/app.log in a file, with the total count on the last line.', goal: 'Write the lines to ~/incident.txt, then add the count to the end of it.',
  hints: ['Use > for the lines.', 'grep -c with >> adds the count without wiping the file.'], why: '> starts the file again every time, while >> adds to it. Mixing them up is the classic way to lose a report.', sol: 'grep FATAL ~/logs/app.log > ~/incident.txt\ngrep -c FATAL ~/logs/app.log >> ~/incident.txt', job: 'Evidence saved to a file survives after your terminal scrolls away.' });

ch('Columns');
sh({ title: 'The last request', from: 'Support', answer: ans(A[A.length - 1][PA]), teaches: ['cut', '-d', '-f'],
  learn: ['cut pulls out one column. -d sets the separator and -f picks which field.', "tail -3 sales.txt | cut -d' ' -f2"],
  brief: 'Which path was requested last in ~/logs/api-access.log? Columns are: time ip method path status ms bytes.', goal: 'Run: submit <path>',
  hints: ['tail -1 gets the last line.', "cut -d' ' -f4 keeps the path column."], why: 'tail and cut together pull a single value out of a structured line.', sol: "tail -1 ~/logs/api-access.log | cut -d' ' -f4", job: 'Seeing the latest entry confirms whether a service is still logging.' });
sh({ title: 'Sort it out', from: 'SRE', answer: ans(Math.max(...A.map((r) => r[MS]))), teaches: ['sort', '-k', '-n'],
  learn: ['sort orders lines as text by default, so 90 lands after 800. -n sorts as numbers, -k picks the column, -r reverses, and -u drops repeats.', 'sort -k2 -n scores.txt\nsort -u names.txt'],
  brief: 'What is the highest response time in ms in ~/logs/api-access.log? It is the 6th column.', goal: 'Run: submit <ms>',
  hints: ['sort -n compares as numbers.', '-k6 sorts on column 6. The biggest ends up last.'], why: 'Text sort compares character by character. Numeric sort is what you want for sizes and durations.', sol: "sort -k6 -n ~/logs/api-access.log | tail -1 | cut -d' ' -f6", job: 'Worst-case latency is where user complaints come from.' });
sh({ title: 'The top-N counter', from: 'Product', answer: ans(top(by(A, (r) => r[PA]))), teaches: ['uniq', '-c', '-r'],
  learn: ['uniq -c counts repeats, but only next to each other, so sort first. Sort again with -rn to put the biggest count on top.', "cut -d' ' -f1 visits.log | sort | uniq -c | sort -rn | head -3"],
  brief: 'Product wants the busiest API path in ~/logs/api-access.log.', goal: 'Run: submit <path>',
  hints: ['cut the path column.', 'sort | uniq -c | sort -rn is the classic counter.'], why: "sort | uniq -c | sort -rn is the most useful shell idiom you'll learn. uniq only collapses neighbours, so sort first.", sol: "cut -d' ' -f4 ~/logs/api-access.log | sort | uniq -c | sort -rn | head -1", job: "You'll type this pipeline for the rest of your career." });

ch('System');
sh({ title: 'Who can run this?', from: 'Platform', par: 2, teaches: ['-l', 'chmod', '+x'], check() { const f = fs.get(HOME + '/tools/backup.sh'); return !!f && !!(f.m & 0o100); },
  learn: ['ls -l shows permissions like -rw-r--r--: read, write and execute, for the owner, the group and everyone else. chmod changes them, and chmod +x makes a file runnable.', 'ls -l run.sh\nchmod +x run.sh\n./run.sh'],
  brief: "~/tools/backup.sh won't run: it says Permission denied. Check its permissions and fix them.", goal: 'Make ~/tools/backup.sh executable.',
  hints: ['ls -l ~/tools shows no x in the mode.', 'chmod +x ~/tools/backup.sh'], why: 'Linux only runs a file if its execute bit is set, which stops a downloaded file running by accident.', sol: 'ls -l ~/tools/backup.sh\nchmod +x ~/tools/backup.sh', job: '"Permission denied" on a new script is nearly always this.' });
sh({ title: 'Search the tree', from: 'SRE', answer: ['7'], teaches: ['find', '-name'],
  learn: ['find searches a whole folder tree. -name matches file names and -type f limits it to files. Pipe into wc -l to count results.', "find ~/photos -name '*.jpg' | wc -l"],
  brief: 'How many files named exactly app.log are under ~/archive?', goal: 'Run: submit <count>',
  hints: ['find ~/archive -name app.log', 'Pipe to wc -l.'], why: 'find walks a whole tree, and -name matches the base name exactly unless you use a glob.', sol: 'find ~/archive -name app.log | wc -l', job: 'Finding files across a tree is daily sysadmin work.' });
sh({ title: 'Find and act', from: 'Platform', teaches: ['-exec', '{}'], check() { const k = []; walk(HOME + '/build', (p, n) => { if (n.t === 'f') k.push(p); }); return k.length === 3 && !k.some((p) => p.endsWith('.tmp')); },
  learn: ["find can run a command on each match. -exec cmd {} \; replaces {} with the file's path. Quote the pattern so find sees it, not the shell, and run without -exec first to preview.", "find ~/cache -name '*.bak'\nfind ~/cache -name '*.bak' -exec rm {} \;"],
  brief: 'Delete every .tmp file under ~/build, in all folders. Keep everything else.', goal: 'Do it in one find command.',
  hints: ["-name '*.tmp' with quotes.", '-exec rm {} \; runs rm on each one.'], why: 'find picks the files and -exec acts on them, so a cleanup covers a whole tree in one line. Previewing first is what keeps it safe.', sol: "find ~/build -name '*.tmp' -exec rm {} \;", job: 'Scoped cleanups stop disks filling up.' });

ch('awk');
sh({ title: 'Fields with awk', from: 'SRE', answer: ans(top(by(A, (r) => r[IP]))), teaches: ['awk', 'print'],
  learn: ['awk splits each line into fields called $1, $2 and so on, on whitespace by default. It saves the fiddling with cut.', "awk '{print $3}' people.txt"],
  brief: 'One client sends far more requests than anyone else in ~/logs/api-access.log. Find its IP.', goal: 'Run: submit <ip>',
  hints: ["awk '{print $2}' prints the IP column.", 'Then count with sort and uniq -c.'], why: 'awk splits on whitespace for you, so column work needs no delimiter flags.', sol: "awk '{print $2}' ~/logs/api-access.log | sort | uniq -c | sort -rn | head -1", job: 'Finding a chatty client is step one for capacity and rate limit work.' });
sh({ title: 'Filter and total', from: 'Product', answer: ans(Math.round(A.filter((r) => r[PA] === '/v1/orders').reduce((s, r) => s + r[MS], 0) / cnt(A, (r) => r[PA] === '/v1/orders'))), teaches: ['END', 'printf'],
  learn: ['awk runs its { } block on every line, and END { } runs once at the very end. Put a condition before a block to run it only on matching lines. Keep a sum and a count, then divide in END. printf "%.0f" rounds.', "awk '$1==\"cat\"{s+=$2;n++} END{printf \"%.0f\\n\", s/n}' pets.txt"],
  brief: 'What is the average ms for /v1/orders in ~/logs/api-access.log, rounded to a whole number? Path is field 4 and ms is field 6.', goal: 'Run: submit <ms>',
  hints: ['Filter with $4=="/v1/orders".', 'printf "%.0f" rounds. Track sum and count.'], why: 'Pattern plus action lets awk filter and aggregate in the same step, with no grep needed.', sol: "awk '$4==\"/v1/orders\"{s+=$6;n++} END{printf \"%.0f\\n\", s/n}' ~/logs/api-access.log", job: 'Latency per endpoint is the basis of every SLO.' });
sh({ title: 'Group by', from: 'Finance', answer: ans(top(by(DATA.cust, (r) => r[2], (r) => r[4]))), teaches: ['-F', 'NR', 'for'],
  learn: ['-F sets awk\'s separator, and NR>1 skips a header row. An array like s[$1] keeps one total per key, and for (k in s) loops over the keys in END.', "awk -F, 'NR>1{s[$1]+=$2} END{for(k in s)print s[k],k}' sales.csv"],
  brief: 'Using ~/data/customers.csv (id,name,plan,country,mrr,signup), which plan has the highest total mrr?', goal: 'Run: submit <plan>',
  hints: ['awk -F, for commas, NR>1 for the header.', 's[$3]+=$5, then a for loop in END.'], why: 'Associative arrays group by any key, which is a GROUP BY in one line.', sol: "awk -F, 'NR>1{s[$3]+=$5} END{for(k in s)print s[k],k}' ~/data/customers.csv | sort -rn | head -1", job: 'Quick revenue cuts save waiting for a dashboard.' });

ch('sed');
sh({ title: 'Find and replace', from: 'Platform', teaches: ['sed', 's/'], check() { const f = fs.get(HOME + '/conf/endpoints-new.conf'); return !!f && f.c === 'upstream=api.whiteraven.example\nmetrics=stats.whiteraven.example\ncdn=cdn.whiteraven.example\n'; },
  learn: ['sed s/old/new/ replaces text on each line, and adding g replaces every match on the line. A dot matches any character, so write \\. when you mean a real dot.', "sed 's/foo\\.com/bar.com/' sites.txt > new.txt"],
  brief: 'Every host in ~/conf/endpoints.conf must move from old-host.example to whiteraven.example.', goal: 'Write the result to ~/conf/endpoints-new.conf with one sed command.',
  hints: ['s/old/new/ replaces. Dots match anything unless escaped.', 'Use > to write a new file.'], why: 'sed applies a substitution to every line. Writing to a new file keeps the original for a safe rollback.', sol: "sed 's/old-host\\.example/whiteraven.example/' ~/conf/endpoints.conf > ~/conf/endpoints-new.conf", job: 'Migrations are full of edits like this.' });
sh({ title: 'Delete and print lines', from: 'SRE', teaches: ['/d', '^', '$'], check() { const f = fs.get(HOME + '/conf/nginx-clean.conf'); return !!f && f.c === 'worker_processes 4;\nkeepalive_timeout 65;\ngzip on;\n'; },
  learn: ["sed /pattern/d deletes matching lines. ^ means line start and $ means line end, so ^$ is a blank line. Separate commands with ; and use sed -n '5p' to print only line 5.", "sed '/^;/d; /^$/d' settings.ini\nsed -n '5p' notes.txt"],
  brief: 'Reviewers only want live settings from ~/conf/nginx-comments.conf.', goal: 'Write it to ~/conf/nginx-clean.conf without comment lines or blank lines.',
  hints: ['/^#/d deletes comment lines.', '/^$/d deletes blank lines. Separate with ;'], why: '^ and $ anchor to the start and end of a line, so ^$ means an empty line.', sol: "sed '/^#/d; /^$/d' ~/conf/nginx-comments.conf > ~/conf/nginx-clean.conf", job: 'Comparing real settings between servers starts here.' });

ch('Patterns');
sh({ title: 'Regex basics', from: 'SRE', answer: ans(cnt(DATA.app, (l) => / (ERROR|FATAL) /.test(l))), teaches: ['-E'],
  learn: ['grep -E turns on extended patterns: a|b means a or b, + means one or more, ? means optional, [0-9] means any digit, and parentheses group choices.', "grep -E 'cat|dog' pets.txt\ngrep -E '^[0-9]+$' numbers.txt"],
  brief: 'How many lines in ~/logs/app.log are ERROR or FATAL?', goal: 'Run: submit <count>',
  hints: ['grep -E allows a|b.', 'Add -c.'], why: 'Extended regex gives you alternation without backslashes.', sol: "grep -Ec ' (ERROR|FATAL) ' ~/logs/app.log", job: 'Severity filters are the first cut on any app log.' });
sh({ title: 'Rearrange with groups', from: 'Data', teaches: ['\\1'], check() { const f = fs.get(HOME + '/data/customers-clean.csv'); return !!f && f.c === joinL(lines(customersCsv).map((l) => l.replace(/(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$2-$1'))); },
  learn: ['sed -E lets you capture parts with ( ) and reuse them as \\1, \\2. Any character can be the delimiter, such as #, which helps when the text contains /.', "sed -E 's#(\\w+)/(\\w+)#\\2/\\1#' pairs.txt"],
  brief: 'The warehouse needs YYYY-MM-DD, but the signup column in ~/data/customers.csv is DD/MM/YYYY.', goal: 'Write ~/data/customers-clean.csv with one sed command and keep the header.',
  hints: ['sed -E gives you (groups).', 'Rebuild as \\3-\\2-\\1. Use # as the delimiter so / needs no escaping.'], why: 'Capture groups rearrange text without knowing the values.', sol: "sed -E 's#([0-9]{2})/([0-9]{2})/([0-9]{4})#\\3-\\2-\\1#' ~/data/customers.csv > ~/data/customers-clean.csv", job: 'Cleaning exports before import is routine data work.' });
sh({ title: 'Clean up characters', from: 'Support', teaches: ['tr', '-d', '<'], check() { const f = fs.get(HOME + '/conf/unix.txt'); return !!f && f.c === 'alpha\nbravo\ncharlie\n'; },
  learn: ['tr swaps or deletes single characters, and -d deletes them. It only reads standard input, so feed it a file with <.', "tr -d ',' < numbers.txt > clean.txt"],
  brief: '~/conf/windows.txt came from a Windows PC and each line ends in \\r, which breaks scripts.', goal: 'Write ~/conf/unix.txt with the carriage returns removed.',
  hints: ['tr -d removes characters.', 'tr reads stdin, so use < or a pipe.'], why: 'Windows ends lines with CR LF. A hidden \\r at the end of a line breaks shell scripts in confusing ways.', sol: "tr -d '\\r' < ~/conf/windows.txt > ~/conf/unix.txt", job: "A script that 'looks fine' but fails is often this." });

ch('Scripting');
sh({ title: 'Variables and quoting', from: 'SRE', par: 2, answer: ans(cnt(A, (r) => r[ST] === 500)), teaches: ['$(', 'echo', '='],
  learn: ['NAME=value sets a variable, with no spaces around the =. $NAME reads it back, and $(command) captures what a command printed. Double quotes keep the value as one piece and still expand it. Single quotes keep everything literal.', 'N=$(wc -l < notes.txt)\necho "Notes: $N"'],
  brief: 'Store the number of 500 errors in ~/logs/api-access.log in a variable, then print it in a sentence.', goal: 'Run: submit <the count>',
  hints: ["Put spaces around 500 in grep so it can't match a byte count.", "E=$(grep -c ' 500 ' ~/logs/api-access.log)"], why: '$( ) turns a command\'s output into a value you can reuse, which is the step from one-liners to scripts.', sol: "E=$(grep -c ' 500 ' ~/logs/api-access.log)\necho \"Count: $E\"", job: 'Scripts capture values like this all the time, to alert when a count is too high.' });
sh({ title: 'Loop over files', from: 'Finance', teaches: ['do', 'done', '${'], check() { const k = fs.kids(HOME + '/reports'); return k.length === 7 && !k.some((x) => x.endsWith('.TXT')) && !!fs.get(HOME + '/reports/q3 summary.txt'); },
  learn: ['A for loop repeats commands over a list. ${f%.old} removes .old from the end of the name. Quote "$f" so names with spaces stay safe.', 'for f in *.jpeg; do mv "$f" "${f%.jpeg}.jpg"; done'],
  brief: 'Reports in ~/reports should end in .txt, not .TXT. One name has a space.', goal: 'Rename them with one for loop. Leave archive.txt alone.',
  hints: ['for f in ~/reports/*.TXT; do ...; done', '${f%.TXT} removes the ending. Double quotes protect the space.'], why: 'Parameter expansion edits text with no extra tools. Without quotes, the spaced name splits into two arguments.', sol: 'for f in ~/reports/*.TXT; do mv "$f" "${f%.TXT}.txt"; done', job: 'Loops are where one-liners turn into scripting.' });
sh({ title: 'Read line by line', from: 'SRE', teaches: ['while', 'read', '&&', '||'], check() { const f = fs.get(HOME + '/data/checks.txt'); return !!f && f.c === 'check srv-01\ncheck srv-02\ncheck srv-03\ncheck srv-04\n'; },
  learn: ['while read takes a file one line at a time into a variable, and redirecting after done saves all the output. Every command also returns an exit code: a && b runs b only if a worked, and a || b runs b only if a failed.', 'while read n; do echo "hello $n"; done < names.txt > out.txt\nmkdir logs && echo made || echo failed'],
  brief: 'For each host in ~/data/hosts.txt, write a line like check srv-01 to ~/data/checks.txt.', goal: 'Use a while read loop with one command line.',
  hints: ['while read h; do echo "check $h"; done < file', 'Redirect after done with > to collect all the output.'], why: "while read handles a file one line at a time, and it's safer than for when lines contain spaces.", sol: 'while read h; do echo "check $h"; done < ~/data/hosts.txt > ~/data/checks.txt', job: 'Looping over host lists is everyday fleet work.' });
sh({ title: 'Capstone: the report script', from: 'SRE', par: 5, teaches: ['#!', '$1'], check() { const p = HOME + '/bin/report.sh', f = fs.get(p); return !!f && !!(f.m & 0o100) && f.c.includes('$1') && S.ranScript === p; },
  learn: ['A script is a file of commands. The first line, #!/bin/bash, says which program runs it. $1 is the first word you pass in. Make it runnable with chmod +x, then run it by its path.', "echo '#!/bin/bash' > hi.sh\necho 'echo \"hello $1\"' >> hi.sh\nchmod +x hi.sh\n./hi.sh amina"],
  brief: 'Anything you type twice should be a script. Build ~/bin/report.sh, which counts the lines in ~/logs/app.log that contain whatever word you pass it.', goal: 'Create the script, make it executable, then run: ~/bin/report.sh ERROR',
  hints: ["mkdir -p ~/bin, then build the file with echo ... > and echo ... >>. Use single quotes so $1 stays literal.", "The command inside is: grep -c \"$1\" ~/logs/app.log"], why: 'A script is a saved pipeline with a parameter. Once it exists, anyone can run it and get the same answer.', sol: "mkdir -p ~/bin\necho '#!/bin/bash' > ~/bin/report.sh\necho 'grep -c \"$1\" ~/logs/app.log' >> ~/bin/report.sh\nchmod +x ~/bin/report.sh\n~/bin/report.sh ERROR", job: 'Nearly all automation starts as a script somebody got tired of retyping.' });
