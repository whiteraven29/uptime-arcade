/* vi track: from "how do I get out" to macros. Interim: M1 converts this to content/missions/vi. */
import { S } from '../../engines/host.js';
import { HOME, F, fs } from '../../engines/fs/index.js';
import { addMission, chapter } from './registry.mjs';

const ch = (name) => chapter('VI', name);
const vi = (o) => {
  const p = `${HOME}/vi/${o.f}`;
  F(p, o.start);
  const needs = o.needs || [];
  addMission('VI', {
    kind: 'auto', parKind: 'keys', file: p, sol: o.keys,
    goal: `${o.goal || 'Make the change'}, then save with :wq. You must use vi: vi ~/vi/${o.f}`,
    check() {
      const n = fs.get(p);
      const used = (S.viUsed && S.viUsed[p]) || [];
      return !!n && n.c === o.target && (S.viKeys[p] || 0) > 0 && needs.every((k) => used.includes(k));
    },
    ...o,
  });
};

ch('Survival');
vi({ title: 'Get in and out', from: 'Support', f: 'welcome.txt', start: 'to wr-dev01\n', target: 'Welcome to wr-dev01\n', par: 15, keys: 'iWelcome <Esc>:wq<CR>', teaches: ['i', ':wq', ':q!'],
  learn: ['vi is a text editor found on every Linux server. It has modes. You start in normal mode, where keys are commands, not text. i enters insert mode so you can type. Esc goes back to normal. :wq saves and quits, and :q! quits without saving when you get stuck.', 'vi notes.txt\ni   type your text   <Esc>\n:wq<Enter>'],
  brief: 'The welcome message in ~/vi/welcome.txt has lost its first word. Add "Welcome " to the start.', hints: ['Press i, type the word and a space, then press Esc.', 'Type :wq and press Enter to save and leave.'], why: 'vi has modes. Normal mode is for moving and commands, and insert mode is for typing. Most new users are stuck only because they are in the wrong mode.', job: 'Every Linux server has vi, even when nothing else is installed.' });
vi({ title: 'Walk the cursor', from: 'Platform', f: 'host.yaml', start: 'host: web\nprt: 8080\nrle: edge\n', target: 'host: web\nport: 8080\nrole: edge\n', par: 15, keys: 'jlio<Esc>jio<Esc>:wq<CR>', teaches: ['h', 'j', 'k', 'l'],
  learn: ['In normal mode h moves left, j down, k up and l right. They sit under your fingers, so you never reach for the arrows.', 'j  down one line\nl  right one character\nk  back up\nh  back left'],
  brief: 'In ~/vi/host.yaml the words prt and rle are each missing a letter. Fix both so they read port and role.', hints: ['j goes down, l goes right. Stand on the r of prt.', 'i inserts before the cursor, so press i, o, Esc. Then do the same on the next line.'], why: 'Everything in vi starts from where the cursor is, and hjkl put you there without leaving the home row.', job: 'YAML typos cause a large share of failed deploys.' });
vi({ title: 'Jump by words', from: 'SRE', f: 'note.txt', start: 'restart api now\n', target: 'restart the api now\n', par: 12, keys: 'withe <Esc>:wq<CR>', teaches: ['w', 'b', 'e'],
  learn: ['w jumps to the start of the next word, b jumps back a word, and e jumps to the end of the word. Much faster than tapping l.', 'w  next word\nb  back a word\ne  end of word'],
  brief: 'In ~/vi/note.txt add the word "the" before "api".', hints: ['w lands on api.', 'i, then type the word and a space, then Esc.'], why: 'Words are the natural unit of text, and w b e let you move by them.', job: 'Long config lines are quick to cross once you move by word.' });
vi({ title: 'Line edges', from: 'SRE', f: 'timeout.conf', start: '    timeout: 30\n', target: '    #timeout: 30\n', par: 9, keys: '^i#<Esc>:wq<CR>', teaches: ['0', '^', '$'],
  learn: ['0 jumps to the very start of a line, ^ to the first character that is not a space, and $ to the end.', '0  column one\n^  first real character\n$  last character'],
  brief: 'In ~/vi/timeout.conf comment out the setting by putting # right before the word timeout, keeping the indent.', hints: ['^ skips the indent.', 'Then i, #, Esc.'], why: '^ is the one you want on indented code: it lands on the text, not on the spaces.', job: 'Commenting out a setting is the safest way to switch it off.' });
vi({ title: 'Top, bottom, line N', from: 'Platform', f: 'hosts.txt', start: 'web-a\nweb-b\nweb-c\nweb-d\nweb-e\n', target: 'web-a\nweb-b\n# web-c\nweb-d\n# web-e\n', par: 17, keys: ':3<CR>i# <Esc>Gi# <Esc>:wq<CR>', teaches: ['gg', 'G', ':N'],
  learn: ['gg goes to the top of the file and G to the bottom. :12 then Enter jumps to line 12, which is exactly what you need when an error message names a line.', 'gg     first line\nG      last line\n:12    line 12'],
  brief: 'In ~/vi/hosts.txt comment out line 3 and the last line by adding "# " at the start of each.', hints: [':3 and Enter takes you to line 3.', 'G takes you to the last line. Use i to insert.'], why: 'Jumping directly to a line beats scrolling, and error messages always tell you the line.', job: 'A failing config usually reports its line number.' });

ch('Inserting');
vi({ title: 'Add text anywhere', from: 'Support', f: 'motd.txt', start: 'Welcome to wr-dev01\n', target: 'Welcome to wr-dev01\nMaintenance: Sunday 02:00\n', par: 32, keys: 'oMaintenance: Sunday 02:00<Esc>:wq<CR>', teaches: ['a', 'A', 'o', 'O', 'I'],
  learn: ['There are several ways into insert mode. a inserts after the cursor, A at the end of the line, I at the start. o opens a new line below and O a new line above.', 'a  after cursor\nA  end of line\nI  start of line\no  new line below\nO  new line above'],
  brief: 'Open ~/vi/motd.txt and add a second line: Maintenance: Sunday 02:00', hints: ['o opens a new line below and enters insert mode.', 'Escape returns to normal mode.'], why: 'Choosing the right way into insert mode saves moving the cursor first.', job: 'A message of the day warns everyone who logs in.' });
vi({ title: 'Fix one character', from: 'Platform', f: 'replica.yaml', start: 'replicaas: 3\nport: 7080\n', target: 'replicas: 3\nport: 8080\n', par: 12, keys: 'ehxjhr8:wq<CR>', teaches: ['x', 'r'],
  learn: ['x deletes the character under the cursor. r replaces it with the next key you press, and you stay in normal mode.', 'x   delete this character\nrX  replace it with X'],
  brief: 'In ~/vi/replica.yaml remove the extra a in replicaas, and change port 7080 to 8080.', hints: ['e jumps to the end of the word, h steps back onto the extra a.', 'r8 on the 7. No insert mode needed.'], why: 'r and x fix a typo without ever leaving normal mode, so there is no Esc to forget.', job: 'One-character mistakes are the most common kind in config files.' });
vi({ title: 'Take it back', from: 'SRE', f: 'undo.yaml', start: 'cache: on\nxport: 8080\n', target: 'cache: on\nport: 8080\n', par: 12, keys: 'jxxxuuu<C-r>:wq<CR>', teaches: ['u', 'C-r'], needs: ['u', 'C-r'],
  learn: ['u undoes your last change, and pressing it again goes further back. Ctrl-r redoes what you just undid, so you can step back and forward through your edits.', 'u       undo\nCtrl-r  redo'],
  brief: 'In ~/vi/undo.yaml only the x should go from xport. Practise recovering: go to that line, press x three times by mistake, undo all three with u, then redo just one with Ctrl-r.', goal: 'Leave the line reading port: 8080, using both u and Ctrl-r', hints: ['j, then x x x. You will see too much vanish.', 'u u u restores it. Ctrl-r brings back only the first x.'], why: 'Undo means mistakes are cheap, so you can try an edit freely and step back and forward through it.', job: 'Undo is what keeps a live server edit calm.' });

ch('Operators');
vi({ title: 'Delete smart', from: 'SRE', f: 'flags.yaml', start: 'cache: on\ndebug: true\nmetrics: on\n', target: 'cache: on\nmetrics: on\n', par: 7, keys: 'jdd:wq<CR>', teaches: ['d', 'D'],
  learn: ['d is an operator: it waits for a motion to say how much. dw deletes a word, d$ to the end of the line, and D is short for that. Doubling it, dd, deletes the whole line.', 'dw  delete a word\nD   delete to end of line\ndd  delete the line'],
  brief: 'Delete the debug line from ~/vi/flags.yaml.', hints: ['j moves down to it.', 'dd deletes the whole line.'], why: 'Doubling an operator acts on the whole line: dd, yy, cc. Operator plus motion is the grammar of vi.', job: 'Leaving debug on in production is a classic slowdown.' });
vi({ title: 'Do it N times', from: 'SRE', f: 'cron.txt', start: '0 2 * * * backup\n# BEGIN TEMP\n0 3 * * * test-a\n0 4 * * * test-b\n0 5 * * * rotate\n', target: '0 2 * * * backup\n0 5 * * * rotate\n', par: 8, keys: 'j3dd:wq<CR>', teaches: ['3dd'],
  learn: ['A number before a command repeats it. 3dd deletes three lines, 5j moves down five, and 2w jumps two words.', '2dd  delete two lines\n4j   down four lines'],
  brief: 'Delete the three temporary lines (the BEGIN TEMP marker and the two test jobs) from ~/vi/cron.txt.', hints: ['j gets you onto the marker.', '3dd deletes three lines.'], why: 'Counts work with almost every command: 3dd, 5j, 2w.', job: 'Removing temporary jobs is a habit that prevents surprises.' });
vi({ title: 'Change in place', from: 'SRE', f: 'app.yaml', start: 'name: api\nport: 8080\nlog_level: debug\nworkers: 4\n', target: 'name: api\nport: 8080\nlog_level: info\nworkers: 4\n', par: 16, keys: '2jwwcwinfo<Esc>:wq<CR>', teaches: ['c', 'C'],
  learn: ['c is the change operator: it deletes and leaves you in insert mode. cw changes a word, cc the whole line, and C from the cursor to the end of the line.', 'cw  change a word\ncc  change the line\nC   change to end of line'],
  brief: 'Set log_level to info in ~/vi/app.yaml.', hints: ['2j, then w w lands on debug.', 'cw, type info, Esc.'], why: 'Go to the thing, then act on it. c does the delete and the switch to insert in one step.', job: "You'll do this over SSH on live servers." });

ch('Finding');
vi({ title: 'Jump to a character', from: 'Platform', f: 'nodes.csv', start: 'web01,dar,8080,active\n', target: 'web01,dar,9090,active\n', par: 15, keys: 'f,;lcw9090<Esc>:wq<CR>', teaches: ['f', 't', ';', ','],
  learn: ['f plus a character jumps to it on the current line, and t stops just before it. ; repeats the jump, and , repeats it backwards. This lets you hop along a line from comma to comma.', 'f,  to the next comma\nt,  just before it\n;   again\n,   back again'],
  brief: 'In ~/vi/nodes.csv change the port to 9090.', hints: ['f, jumps to a comma and ; repeats it.', 'l moves right, then cw.'], why: '; repeats the last f search, so you can hop across delimited data.', job: 'Hand-editing CSV and config columns is common during incidents.' });
vi({ title: 'Search the file', from: 'SRE', f: 'timeouts.yaml', start: '# timeouts\nweb_timeout: 30\ndb_timeout: 30\ncache_timeout: 30\n', target: '# timeouts\nweb_timeout: 30\ndb_timeout: 90\ncache_timeout: 30\n', par: 20, keys: '/timeout:<CR>nwwr9:wq<CR>', teaches: ['/', '?', 'n', 'N'],
  learn: ['/ searches forward and ? searches backward. Type the word and press Enter. n goes to the next match and N to the one before.', '/error<Enter>  find it\nn              next\nN              previous'],
  brief: 'In ~/vi/timeouts.yaml change db_timeout from 30 to 90.', hints: ['/timeout: finds web_timeout first, and n moves on to db_timeout.', 'w w gets to the 30, and r9 changes the 3.'], why: 'Search is the fastest way to move in a big file: jump to the word instead of counting lines.', job: 'Real config files run to thousands of lines, so nobody scrolls.' });
vi({ title: 'Repeat the last change', from: 'Compliance', f: 'links.txt', start: 'docs http://docs.whiteraven.example\nblog http://blog.whiteraven.example\nhelp http://help.whiteraven.example\n', target: 'docs https://docs.whiteraven.example\nblog https://blog.whiteraven.example\nhelp https://help.whiteraven.example\n', par: 24, keys: '/http:<CR>cwhttps<Esc>n.n.:wq<CR>', teaches: ['.'],
  learn: ['. repeats your last change, and n jumps to the next search match. Together they make a fast repeat loop you can run by hand.', '/foo<Enter>  cwbar<Esc>  n  .  n  .'],
  brief: 'Change all three http links in ~/vi/links.txt to https, using the dot command.', goal: 'Change them with n and .', hints: ['cw on http, then n to find the next one.', '. repeats your last change.'], why: '. repeats your last change, so search, change, n, . is a loop you can run by hand.', job: 'Repeating precise edits is what makes vi users fast.' });

ch('Copying');
vi({ title: 'Copy and paste', from: 'Platform', f: 'upstream.conf', start: 'upstream api {\n  server 10.40.10.11:8080;\n}\n', target: 'upstream api {\n  server 10.40.10.11:8080;\n  server 10.40.10.12:8080;\n}\n', par: 22, keys: '/server<CR>yyp/11<CR>lr2:wq<CR>', teaches: ['y', 'p', 'P'],
  learn: ['y is the copy operator, called yank. yy copies a line, p pastes it below and P pastes it above.', 'yy  copy the line\np   paste below\nP   paste above'],
  brief: 'In ~/vi/upstream.conf duplicate the server line and change it to 10.40.10.12.', hints: ['yy copies a line and p pastes below.', 'Search for 11, step right onto the second 1, and r replaces it.'], why: 'Copy then tweak is faster and safer than retyping an address.', job: 'Scaling out often starts with this exact edit.' });
vi({ title: 'Move a line', from: 'SRE', f: 'acl.txt', start: '# guest VLAN outbound, first match wins\ndeny ip any any\npermit udp 10.40.40.0/24 host 10.40.10.53 eq 53\ndeny ip 10.40.40.0/24 10.40.20.0/24\npermit tcp 10.40.40.0/24 any eq 443\n', target: '# guest VLAN outbound, first match wins\npermit udp 10.40.40.0/24 host 10.40.10.53 eq 53\ndeny ip 10.40.40.0/24 10.40.20.0/24\npermit tcp 10.40.40.0/24 any eq 443\ndeny ip any any\n', par: 10, keys: 'jddGp:wq<CR>', teaches: ['ddp'],
  learn: ['dd keeps what it deleted, so it also works as cut. Move somewhere else and p pastes it there. That moves a line in a few keys.', 'dd  G  p'],
  brief: 'A catch-all deny sits near the top of ~/vi/acl.txt, so guests have no access. Move it to the end.', goal: 'Move the line to the end', hints: ['dd cuts the line.', 'G goes to the last line and p pastes below.'], why: 'dd is cut and p is paste. In an ACL the first match wins, so a catch-all belongs last.', job: 'A wrongly ordered ACL can take a whole office offline.' });
vi({ title: 'Join wrapped lines', from: 'Platform', f: 'unit.txt', start: 'ExecStart=/usr/bin/api\n--port 8080\n', target: 'ExecStart=/usr/bin/api --port 8080\n', par: 5, keys: 'J:wq<CR>', teaches: ['J'],
  learn: ['J pulls the next line up onto this one and adds a space.', 'J'],
  brief: 'The command in ~/vi/unit.txt got split onto two lines. Join them.', hints: ['J joins the next line to this one.', 'It adds a space for you.'], why: 'J handles the newline and the spacing in one key.', job: 'Wrapped pastes break systemd units and shell commands.' });
vi({ title: 'Fix the indent', from: 'Platform', f: 'svc.yaml', start: 'service:\nimage: api:1.4\nport: 8080\n', target: 'service:\n  image: api:1.4\n  port: 8080\n', par: 16, keys: '/image<CR>>>j>>:wq<CR>', teaches: ['>', '<'],
  learn: ['>> indents the current line by one level, and << removes one level.', '>>  indent\n<<  outdent'],
  brief: 'Indent the image and port lines by one level in ~/vi/svc.yaml.', hints: ['>> indents a line.', 'j moves down.'], why: '>> shifts a line right and << shifts it left. In YAML, indentation changes the meaning.', job: 'Bad indentation is the most common YAML failure.' });

ch('Ex commands');
vi({ title: 'Replace on one line', from: 'Platform', f: 'tags.txt', start: 'keep: old\nchange: old old\n', target: 'keep: old\nchange: new old\n', par: 17, keys: 'j:s/old/new/<CR>:wq<CR>', teaches: [':s'],
  learn: [':s/old/new/ replaces the first match on the current line. Typing : opens the command line at the bottom, where ex commands like this and :wq live.', ':s/cat/dog/<Enter>'],
  brief: 'In ~/vi/tags.txt, on line 2 only, change the first old to new.', hints: ['j gets you to line 2.', ':s/old/new/ only touches the first match on this line.'], why: ':s works on one line by default, and only on the first match unless you add g.', job: 'A precise one-line replace leaves everything else untouched.' });
vi({ title: 'Replace everywhere', from: 'Platform', f: 'env.yaml', start: 'db: staging-db\ncache: staging-cache\nqueue: staging-queue\nregion: dar\n', target: 'db: prod-db\ncache: prod-cache\nqueue: prod-queue\nregion: dar\n', par: 25, keys: ':%s/staging/prod/g<CR>:wq<CR>', teaches: ['%'],
  learn: ['% in front of :s means every line in the file. g on the end means every match on each line.', ':%s/cat/dog/g<Enter>'],
  brief: 'Replace every staging with prod in ~/vi/env.yaml in one command.', hints: [':%s/old/new/g runs on the whole file.', '% means every line.'], why: ':s is sed inside vi. % selects the whole file and g every match per line.', job: 'Global replace is the fastest big edit you can make.' });
vi({ title: 'Work on ranges', from: 'SRE', f: 'switches.conf', start: 'a: on\nb: on\nc: on\nd: on\ne: on\n', target: 'a: on\nd: off\ne: off\n', par: 24, keys: ':2,3d<CR>:.,$s/on/off/<CR>:wq<CR>', teaches: [':d', '.,$'],
  learn: ['Ex commands take a line range. :2,3d deletes lines 2 and 3. In a range . means the current line and $ means the last, so :.,$s runs from here to the end.', ':10,20d\n:.,$s/a/b/'],
  brief: 'In ~/vi/switches.conf delete lines 2 and 3. The cursor lands on the next line, so from there to the end turn on into off.', hints: [':2,3d deletes both lines.', ':.,$s/on/off/ covers the current line to the last.'], why: 'Ranges let one command touch exactly the block you mean, with no cursor movement.', job: 'Ranges are how you edit a block without touching the rest of the file.' });

ch('Precision');
vi({ title: 'Text objects', from: 'Backend', f: 'call.py', start: 'name = "old value"\nsize = max(10, 20)\n', target: 'name = "new"\nsize = max()\n', par: 16, keys: 'ci"new<Esc>jdi(:wq<CR>', teaches: ['i"', 'i(', 'a(', 'iw'],
  learn: ['After an operator, i means inside and a means around. ciw changes the word under the cursor, ci" changes inside quotes, di( deletes inside brackets, and da( takes the brackets too. The cursor can be anywhere in the object.', 'ciw  change this word\nci"  change inside quotes\ndi(  delete inside ( )\nda(  delete ( ) as well'],
  brief: 'In ~/vi/call.py replace the quoted text with new, keeping the quotes. Then on the next line empty the brackets of max, keeping the brackets.', hints: ['ci" works from anywhere on the line up to the closing quote.', 'After Esc, j moves down onto the bracket, then di(.'], why: 'Text objects describe what you mean, inside these quotes, so the cursor does not have to be anywhere exact.', job: 'This is the moment vi starts to feel faster than a mouse.' });
vi({ title: 'Visual selection', from: 'SRE', f: 'visual.txt', start: 'keep\ndrop1\ndrop2\nserver old web01\n', target: 'keep\nserver web01\n', par: 14, keys: 'jVjdwvwhd:wq<CR>', teaches: ['v', 'V'],
  learn: ['v starts selecting by character and V selects whole lines. Move to grow the selection, then press an operator like d, y, c or >. Esc cancels.', 'V j d   delete two lines\nv e y   copy to end of word'],
  brief: 'In ~/vi/visual.txt delete the two drop lines with V, then delete the word old and its space with v.', hints: ['j, V, j, d takes out both lines.', 'w moves to old. v, w, h selects it and its space. d deletes it.'], why: 'Selecting first lets you see exactly what will change before you commit to it.', job: 'When a motion is hard to count, select it instead.' });
vi({ title: 'Column edits', from: 'Platform', f: 'column.txt', start: 'web1\nweb2\nweb3\n', target: '# web1\n# web2\n# web3\n', par: 12, keys: '<C-v>2jI# <Esc>:wq<CR>', teaches: ['C-v', 'I'],
  learn: ['Ctrl-v selects a rectangle. Move to cover the rows, press I, type your text and press Esc. What you typed appears on every row.', 'Ctrl-v  2j  I  # <Esc>'],
  brief: 'Comment out all three lines of ~/vi/column.txt by adding "# " at the start of each, with one block insert.', hints: ['Ctrl-v, then 2j selects the first column of three rows.', 'I, type # and a space, then Esc.'], why: 'Block mode edits a column on many lines at once, which no line-by-line command can match.', job: 'Commenting out a block is the everyday use.' });

ch('Power');
vi({ title: 'Named registers', from: 'Backend', f: 'registers.txt', start: 'alpha\nbravo\nend\n', target: 'alpha\nbravo\nend\nalpha\nbravo\n', par: 20, keys: '"ayyj"byyG"ap"bp:wq<CR>', teaches: ['"a'],
  learn: ['A register is a named clipboard. "a before a yank stores into register a, and "ap pastes from it. Normal yank and delete keep overwriting the default, but named ones stay put.', '"ayy  copy to a\n"ap   paste a'],
  brief: 'In ~/vi/registers.txt copy line 1 to register a and line 2 to register b, then paste a then b after the last line.', hints: ['"ayy, then j, then "byy.', 'G, then "ap, then "bp.'], why: 'Named registers hold several snippets at once, so one copy no longer wipes out the last.', job: 'Handy when you are moving several pieces around a large file.' });
vi({ title: 'Marks', from: 'SRE', f: 'marks.txt', start: 'top\ninsert after this\nmiddle\nmove me\n', target: 'top\ninsert after this\nmove me\nmiddle\nmove me\n', par: 13, keys: 'jmaGyy\'ap:wq<CR>', teaches: ['m', "'"],
  learn: ["ma drops a mark called a at the current spot. 'a jumps back to that line from anywhere, and d'a deletes from here to the mark.", "ma   set mark a\n'a   jump to mark a"],
  brief: 'In ~/vi/marks.txt set a mark on line 2, copy the last line, jump back to the mark and paste below it.', hints: ['j, then ma.', "G, yy, 'a, p."], why: 'Marks are bookmarks inside a file, so you can look elsewhere and come straight back.', job: 'Useful when you need to read one part of a file while editing another.' });
vi({ title: 'Record a macro', from: 'Platform', f: 'macro.txt', start: 'web1\nweb2\nweb3\nweb4\n', target: 'host web1;\nhost web2;\nhost web3;\nhost web4;\n', par: 24, keys: 'qaIhost <Esc>A;<Esc>jq3@a:wq<CR>', teaches: ['q', '@'],
  learn: ['qa starts recording keys into a, and q stops. @a plays them back, 3@a plays them three times, and @@ repeats the last macro. End a macro on the next line so it can run again.', 'qa  ...keys...  j  q\n3@a'],
  brief: 'Turn each line of ~/vi/macro.txt from web1 into host web1; by recording the edit once and replaying it.', hints: ['qa, I, type host and a space, Esc, A, ;, Esc, j, q.', '3@a does the remaining three.'], why: 'A macro turns one careful edit into a tool, which pays off on any repetitive change regex cannot express.', job: 'Macros reshape a list of hundreds of lines in seconds.' });
vi({ title: 'Global commands', from: 'SRE', f: 'global.conf', start: '# managed\nport=80\n# old\njunk line\nworkers=4\n', target: 'port=80\nworkers=4\n', par: 21, keys: ':g/^#/d<CR>:v/=/d<CR>:wq<CR>', teaches: [':g', ':v'],
  learn: [':g/pattern/d deletes every line that matches. :v/pattern/d deletes every line that does NOT match. They work on the whole file in one go.', ':g/DEBUG/d\n:v/keep/d'],
  brief: 'In ~/vi/global.conf delete all comment lines, then delete every line without an = in it.', hints: [':g/^#/d removes the comments.', ':v/=/d removes what has no =.'], why: ':g and :v apply a command to every line that does or does not match, which is grep for your edits.', job: 'The quickest way to strip a noisy file down to what matters.' });
vi({ title: 'Several files', from: 'Support', f: 'notes.txt', start: 'Release notes\n', target: 'Release notes\nThanks for reading.\n', par: 43, keys: ':r ~/vi/footer.txt<CR>:w ~/vi/release.txt<CR>:wq<CR>', teaches: [':r', ':w', ':e'],
  learn: [':r file reads another file in below the cursor. :w name saves a copy under a new name and stays where you are. :e file opens a different file.', ':r footer.txt\n:w copy.txt\n:e other.txt'],
  brief: 'In ~/vi/notes.txt read in ~/vi/footer.txt, save a copy as ~/vi/release.txt, then save and quit.', goal: 'Read the footer in and write the copy', hints: [':r ~/vi/footer.txt', ':w ~/vi/release.txt, then :wq'], why: ':r and :w let you combine and copy files from inside the editor.', job: 'Pulling a template into a file is a common server task.' });
F(`${HOME}/vi/footer.txt`, 'Thanks for reading.\n');
vi({ title: 'Capstone: refactor the config', from: 'CTO', f: 'capstone.conf', start: '# old file\nHOST=staging\nDEBUG=true\nPORT=8080\n# TODO remove\nRETRIES=3\nREGION=staging\n', target: 'HOST=prod\nPORT=9090\nRETRIES=3\nREGION=prod\nOWNER=sre\n', par: 65, keys: ':g/^#/d<CR>:%s/staging/prod/g<CR>/DEBUG<CR>dd/8080<CR>cw9090<Esc>GoOWNER=sre<Esc>:wq<CR>', teaches: ['capstone'],
  learn: ['Nothing new. Pick the cheapest tool for each part: :g for lines that match, :%s for words everywhere, / to jump, dd and cw to edit, G and o to add at the end.', ':g/^#/d\n:%s/a/b/g\n/word<Enter>  cw...'],
  brief: 'Refactor ~/vi/capstone.conf: remove all comments, change every staging to prod, delete the DEBUG line, change the port to 9090, and add OWNER=sre as the last line. Beat par.', goal: 'Refactor the file under par', hints: ['Start with the whole-file commands: :g and :%s.', '/DEBUG then dd, /8080 then cw, then G and o.'], why: 'Real edits combine everything. Whole-file commands first, then jump and change what is left.', job: 'This is what a real config change looks like over SSH.' });
