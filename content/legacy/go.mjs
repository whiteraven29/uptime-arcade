/* Go track: from hello to a worker pool. Interim: M1 converts this to content/missions/go.
   Every program runs under real `go run` in tools/verify_content.mjs. */
import { addMission, ans, chapter } from './registry.mjs';

const ch = (name) => chapter('GO', name);
const indent = (s) => s.split('\n').map((l) => (l ? `\t${l}` : l)).join('\n');
const program = (o) => {
  const imports = ['"fmt"', ...(o.imports || [])].map((i) => `\t${i}`).join('\n');
  return `package main\n\nimport (\n${imports}\n)\n\n${o.decl ? `${o.decl}\n` : ''}func main() {\n${indent(o.code)}\n}\n`;
};
/* Predict what the program prints. */
const go = (o) => addMission('GO', {
  kind: 'answer', par: 1, answer: ans(o.a), goal: 'Predict the output, then run: submit <the printed text>',
  brief: o.brief || 'Read this Go program and predict exactly what it prints.', sol: `submit ${o.a}`,
  program: program(o), ...o,
});
/* Fill the blank (____) so the program prints what's asked. */
const fix = (o) => addMission('GO', {
  kind: 'answer', par: 1, answer: o.fixes, goal: 'Run: submit <the code that replaces ____>',
  sol: `submit ${o.fixes[0]}`, program: program(o), ...o,
});

ch('Basics');
go({ title: 'Hello, Whiteraven', from: 'Platform', code: 'fmt.Println("Hello, Whiteraven")', a: 'Hello, Whiteraven', teaches: ['package', 'import', 'func', 'main', 'fmt', 'Println'],
  learn: ['Every Go program starts with package main, imports the packages it needs, and begins running at func main(). fmt.Println prints a line. Curly braces hold the body of the function.', 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hi")\n}'],
  hints: ['Execution starts inside func main.', 'Println prints the text between the quotes.'], why: 'package main and func main are where a Go program starts. Everything else is just the instructions inside.', job: 'Every Go service you ever read starts from this exact shape.' });
go({ title: 'Zero values', from: 'Platform', code: 'var n int\nvar s string\nvar ok bool\nfmt.Printf("%d[%s]%v\\n", n, s, ok)', a: '0[]false', teaches: ['var', 'int', 'string', 'bool', ':=', 'Printf'],
  learn: ['var declares a variable, and := declares one and sets it. Go gives every variable a starting zero value: 0 for numbers, "" for strings, false for bools. Printf prints with slots: %d for numbers, %s for strings, %v for anything.', 'var count int\nname := "web"\nfmt.Printf("%s %d\\n", name, count)   // web 0'],
  hints: ['Go has no uninitialised variables.', 'Each type has a zero value, and the empty string prints as nothing.'], why: "Every variable starts at its type's zero value, so there's no undefined state.", job: 'Good Go types are useful at their zero value.' });
go({ title: 'Types and conversion', from: 'Platform', imports: ['"strconv"'], code: 'x := 3\ny := 1.5\nfmt.Println(float64(x)*y, strconv.Itoa(x)+"!")', a: '4.5 3!', teaches: ['float64', 'strconv', 'Itoa'],
  learn: ['Go never converts types silently, so an int and a float64 cannot be multiplied until you convert one: float64(x). strconv.Itoa turns an int into its text form, and + joins strings.', 'n := 2\nfmt.Println(float64(n) / 4)      // 0.5\nfmt.Println(strconv.Itoa(n) + "x") // 2x'],
  hints: ['float64(3) is 3.0, and 3.0 times 1.5 is 4.5.', 'Itoa gives the text "3", and + adds the !.'], why: 'Explicit conversion means no surprise rounding, and the compiler catches type mix-ups for you.', job: 'Numbers arriving as text must be converted before any maths.' });
go({ title: 'Constants and iota', from: 'Platform', decl: 'const (\n\tLow = iota\n\tMid\n\tHigh\n)\n', code: 'fmt.Println(Low, Mid, High)', a: '0 1 2', teaches: ['const', 'iota'],
  learn: ['const declares a value that can never change. Inside a const block iota counts up from 0, and lines left blank repeat the previous rule. It is how Go writes named levels.', 'const (\n\tRed = iota  // 0\n\tGreen       // 1\n)'],
  hints: ['iota starts at 0.', 'Each following line adds one.'], why: 'iota gives a list of named numbers without typing each value, so inserting one cannot leave a duplicate.', job: 'Log levels and states are usually written with iota.' });

ch('Flow');
go({ title: 'Decisions', from: 'Backend', code: 'x := 2\nswitch x {\ncase 2:\n\tfmt.Print("two ")\ncase 3:\n\tfmt.Print("three ")\ndefault:\n\tfmt.Print("other ")\n}\nfmt.Println("end")', a: 'two end', teaches: ['if', 'switch', 'case', 'default', 'Print'],
  learn: ['if needs no brackets around its condition, and can set a variable first: if n := len(s); n > 3 { }. switch picks one case, and Go cases stop by themselves with no break needed. fmt.Print prints without a new line.', 'switch n {\ncase 1:\n\tfmt.Print("one")\ncase 2:\n\tfmt.Print("two")\n}'],
  hints: ['Go cases stop by themselves.', 'fallthrough must be explicit.'], why: 'Unlike C, Go breaks automatically at the end of a case.', job: 'Fewer bugs than C-style switches.' });
go({ title: 'The only loop', from: 'Backend', code: 'sum := 0\nfor i := 1; i <= 3; i++ {\n\tsum += i\n}\nfor _, n := range []int{10, 20} {\n\tsum += n\n}\nfmt.Println(sum)', a: '36', teaches: ['for', 'range', '_', '[]int', '+=', '++'],
  learn: ['for is the only loop in Go. It takes three parts like for i := 0; i < 3; i++, or just a condition, like while in other languages. range walks a slice like []int{1, 2}, giving the index and the value. Use _ for a value you do not need, and += to add to a total.', 'for i := 0; i < 3; i++ { }\nfor n < 10 { }\nfor _, v := range items { }'],
  hints: ['1 + 2 + 3 is 6.', 'Then add 10 and 20.'], why: 'One loop keyword with a few shapes means less to remember. range is the one you use most.', job: 'Nearly every Go function has one of these loops.' });

ch('Functions');
go({ title: 'Many returns', from: 'Backend', decl: 'func divmod(a, b int) (int, int) {\n\treturn a / b, a % b\n}\n', code: 'q, r := divmod(17, 5)\nfmt.Println(q, r)', a: '3 2', teaches: ['return', '%', '/'],
  learn: ['A Go function can return several values. List the types in brackets after the parameters, and unpack them at the call. Between ints, / drops the remainder and % gives it.', 'func split() (int, string) {\n\treturn 1, "a"\n}\nn, s := split()'],
  hints: ['17 / 5 between ints is 3.', '17 % 5 is the remainder.'], why: 'Multiple returns remove the need for special out-parameters, and they make error handling possible.', job: 'Almost all Go functions return a value and an error.' });
fix({ title: 'Errors are values', from: 'Backend', imports: ['"strconv"'], code: 'n, err := strconv.Atoi("abc")\nif ____ {\n\tfmt.Println("bad number")\n\treturn\n}\nfmt.Println(n)', fixes: ['err != nil', 'nil != err'], prints: 'bad number', teaches: ['err', 'nil', 'Atoi', '!='],
  learn: ['Go has no exceptions. A function that can fail returns an error as its last value, and nil means no error. You check it right away with if err != nil.', 'v, err := strconv.Atoi(text)\nif err != nil {\n\treturn\n}'],
  brief: 'Finish the check so a bad number prints "bad number" instead of carrying on with a useless value.', hints: ['err holds the failure.', 'Compare it with nil.'], why: 'Errors are ordinary values, so handling them is visible right where the failure happens.', job: 'if err != nil is the most common line in Go.' });

ch('Slices');
go({ title: 'Arrays vs slices', from: 'Backend', code: 'a := [2]int{1, 2}\nb := a\nb[0] = 9\ns := []int{1, 2}\nt := s\nt[0] = 9\nfmt.Println(a[0], s[0])', a: '1 9', teaches: ['[2]int', 'slice'],
  learn: ['An array has a fixed size in its type, like [2]int, and assigning it copies everything. A slice, []int, is a small view onto an array, so assigning one shares the same data.', 'a := [2]int{1, 2}  // array: copied\ns := []int{1, 2}   // slice: shared'],
  hints: ['b is a full copy of a.', 't looks at the same data as s.'], why: 'Arrays are values and slices are views. That one difference explains most slice surprises.', job: 'You will use slices almost always, and arrays rarely.' });
go({ title: 'Grow with append', from: 'Backend', code: 'a := []int{1, 2}\nb := append(a, 3)\nb[0] = 9\nfmt.Println(a[0], b[0])', a: '1 9', teaches: ['append'],
  learn: ['append adds to a slice and returns the result. A slice has a length and a capacity. When there is no spare capacity, append copies to a new array, so the two slices stop sharing.', 'a := []int{1}\nb := append(a, 2)\nb[0] = 5   // a[0] is still 1'],
  hints: ['a is full: len 2, cap 2.', 'append must allocate a new array.'], why: 'With no capacity left, append copies to a new array, so a and b no longer share memory.', job: 'Sharing depends on capacity, so never rely on it.' });
go({ title: 'The slice that changed by itself', from: 'Backend', code: 'a := []int{1, 2, 3, 4}\nb := a[:2]\nb = append(b, 99)\nfmt.Println(a[2], len(b), cap(b))', a: '99 3 4', teaches: ['len', 'cap', '[:'],
  learn: ['a[:2] is a view of the first two items, sharing memory with a. len is how many it holds and cap is how far it could grow. append writes in place when the array has spare room.', 'a := []int{1, 2, 3}\nb := a[:1]\nb = append(b, 7)   // a[1] is now 7'],
  hints: ["b shares a's array.", 'append writes in place when capacity allows.'], why: 'A slice is a pointer, a length and a capacity. With room left, append overwrites. Use a[:2:2] to force a copy.', job: 'This is one of the commonest real Go bugs.' });
go({ title: 'Copy safely', from: 'Backend', code: 'dst := make([]int, 2)\nn := copy(dst, []int{7, 8, 9})\nfmt.Println(n, dst)', a: '2 [7 8]', teaches: ['make', 'copy'],
  learn: ['make creates a slice of a given length. copy fills the destination up to the shorter length and returns how many items it copied, so it never grows anything.', 'd := make([]int, 1)\nn := copy(d, []int{4, 5})   // n is 1'],
  hints: ['copy takes the shorter length.', 'It returns how many it copied.'], why: 'copy never grows the destination, so size it first. It gives you data that is truly separate.', job: 'Buffer code uses this all the time.' });

ch('Maps and text');
go({ title: 'Look up with comma-ok', from: 'Backend', code: 'hits := map[string]int{"a": 2}\nhits["b"]++\nv, ok := hits["c"]\nfmt.Println(len(hits), v, ok)', a: '2 0 false', teaches: ['map', 'ok'],
  learn: ['A map stores keys and values. Reading a missing key gives the zero value and adds nothing. v, ok := m[k] also tells you if it exists. m[k]++ creates the key. A nil map can be read, but writing to one crashes.', 'm := map[string]int{}\nv, ok := m["z"]   // 0 false'],
  hints: ['Reading a missing key gives zero and adds nothing.', '++ does create the key.'], why: 'Maps return the zero value for missing keys, so counting needs no setup. Comma-ok tells zero from missing.', job: 'Go counters rely on this.' });
go({ title: 'Bytes and runes', from: 'Backend', code: 's := "habari"\nt := "jambo✓"\nfmt.Println(len(s), len(t), len([]rune(t)))', a: '6 8 6', teaches: ['rune', '[]rune'],
  learn: ['A Go string is a row of bytes in UTF-8, so len counts bytes. Characters outside plain English can take several bytes. Convert to []rune to count characters.', 'len("é")            // 2\nlen([]rune("é"))    // 1'],
  hints: ['len counts bytes.', '✓ takes 3 bytes in UTF-8.'], why: 'Strings are bytes, so convert to runes when you need characters.', job: 'This matters for limits on any text that is not plain ASCII.' });

ch('Types');
go({ title: 'Structs', from: 'Backend', decl: 'type Server struct {\n\tName string\n\tPort int\n}\n', code: 's := Server{Name: "web", Port: 80}\ns.Port = 8080\nfmt.Println(s.Name, s.Port)', a: 'web 8080', teaches: ['type', 'struct'],
  learn: ['type and struct define your own group of named fields. Create one with a literal, and read or change fields with a dot.', 'type Pet struct {\n\tName string\n}\np := Pet{Name: "Rex"}\np.Name = "Max"'],
  hints: ['Port starts at 80.', 'The next line changes it.'], why: 'Structs bundle related data under one name, like a class without the ceremony.', job: 'Every API request and config in Go is a struct.' });
go({ title: 'Value vs pointer receivers', from: 'Backend', decl: 'type C struct{ n int }\n\nfunc (c C) IncV()  { c.n++ }\nfunc (c *C) IncP() { c.n++ }\n', code: 'c := C{}\nc.IncV()\nc.IncP()\nfmt.Println(c.n)', a: '1', teaches: ['receiver', '*C'],
  learn: ['A method is a function attached to a type. The receiver goes before its name. A value receiver works on a copy, and a pointer receiver, marked with *, changes the original.', 'func (c Car) Name() string { return c.name }\nfunc (c *Car) Fill()        { c.fuel = 100 }'],
  hints: ['A value receiver gets a copy.', 'Only IncP changes the original.'], why: 'Value receivers work on a copy, and pointer receivers change the original.', job: 'Mixing these up causes state that never updates.' });
go({ title: 'Interfaces', from: 'Backend', decl: 'type Pinger interface {\n\tPing() string\n}\n\ntype Web struct{}\n\nfunc (Web) Ping() string { return "web ok" }\n\ntype DB struct{}\n\nfunc (DB) Ping() string { return "db ok" }\n', code: 'for _, p := range []Pinger{Web{}, DB{}} {\n\tfmt.Print(p.Ping(), " ")\n}\nfmt.Println("done")', a: 'web ok db ok done', teaches: ['interface'],
  learn: ['An interface lists methods. Any type that has those methods satisfies it automatically, with no declaration, so code can work with many types through one name.', 'type Namer interface {\n\tName() string\n}'],
  hints: ['Both types have Ping, so both count as Pinger.', 'Print separates its two values only as written here.'], why: 'Satisfaction is implicit, so you can define an interface where it is used and existing types just fit.', job: 'io.Reader and error are interfaces you will use every day.' });
go({ title: "The nil that isn't nil", from: 'Backend', decl: 'type E struct{}\n\nfunc (*E) Error() string { return "e" }\n\nfunc run() error {\n\tvar p *E\n\treturn p\n}\n', code: 'fmt.Println(run() == nil)', a: 'false', teaches: ['error'],
  learn: ['An interface holds a type and a value. It equals nil only when both are empty, so a nil pointer inside it is not nil. error is itself an interface.', 'var p *T\nvar i any = p\n// i holds the type *T and a nil value'],
  hints: ['An interface holds a type and a value.', "It's nil only when both are nil."], why: "The interface holds type *E with a nil value, so it isn't nil. Return plain nil on success.", job: 'A famous Go trap that passes error checks wrongly.' });

ch('Cleanup');
go({ title: 'defer order', from: 'Platform', code: 'for i := 0; i < 3; i++ {\n\tdefer fmt.Print(i, " ")\n}\nfmt.Print("done ")', a: 'done 2 1 0', teaches: ['defer'],
  learn: ['defer delays a call until the function ends. Several defers run last in, first out. Its arguments are worked out right away, and only the call waits.', 'defer fmt.Print("b")\ndefer fmt.Print("a")\n// prints ab'],
  hints: ['defer runs when the function returns.', 'Last in, first out.'], why: 'Deferred calls stack up and run in reverse order, so cleanup unwinds in the opposite order to setup.', job: 'defer closes files and releases locks.' });
go({ title: 'panic and recover', from: 'Platform', decl: 'func safe() (msg string) {\n\tdefer func() {\n\t\tif r := recover(); r != nil {\n\t\t\tmsg = "caught"\n\t\t}\n\t}()\n\tpanic("boom")\n}\n', code: 'fmt.Println(safe(), "and still running")', a: 'caught and still running', teaches: ['panic', 'recover'],
  learn: ['panic stops normal flow and starts unwinding the program. A deferred function can call recover to catch it. Keep panics for real programmer errors, and use returned errors for everything else.', 'defer func() {\n\tif r := recover(); r != nil {\n\t\tfmt.Println("saved")\n\t}\n}()\npanic("oops")'],
  hints: ['The deferred function still runs during the panic.', 'recover stops it, and the named result is what gets returned.'], why: 'recover only works inside a deferred function, because deferred calls are all that run during a panic.', job: 'Web servers use this to stop one bad request killing the process.' });

ch('Errors and packages');
go({ title: 'Wrap and inspect', from: 'Backend', imports: ['"errors"'], decl: 'var ErrDown = errors.New("down")\n', code: 'err := fmt.Errorf("db: %w", ErrDown)\nfmt.Println(err == ErrDown, errors.Is(err, ErrDown), err)', a: 'false true db: down', teaches: ['Errorf', '%w', 'errors', 'New', 'Is'],
  learn: ['errors.New makes a simple error. fmt.Errorf with %w wraps one, adding context and keeping the original inside. errors.Is looks through the wrapping, which == cannot do.', 'e := fmt.Errorf("read: %w", ErrX)\nerrors.Is(e, ErrX)   // true'],
  hints: ['%w wraps the original.', 'errors.Is unwraps the chain.'], why: 'Wrapping adds context without losing the original, so use errors.Is rather than ==.', job: 'This is the standard Go error pattern.' });
fix({ title: 'Exported names', from: 'Platform', imports: ['"strings"'], code: 'fmt.Println(strings.____("web"))', fixes: ['ToUpper'], prints: 'WEB', teaches: ['strings', 'ToUpper'],
  learn: ['In Go a capital first letter means exported, so visible from other packages. A lowercase name is private to its package. That is why you call strings.ToUpper and never strings.toUpper.', 'strings.ToLower("HI")   // works\nstrings.toLower("HI")   // will not compile'],
  brief: 'This should print WEB. Which function from the strings package goes in the blank? Mind the capitals.', hints: ['It makes text upper case.', 'Exported names start with a capital.'], why: 'Capitalisation is the whole visibility system in Go: no public or private keywords.', job: 'A lowercase field also silently vanishes from JSON output, which catches everyone once.' });

ch('Concurrency');
go({ title: 'Goroutines', from: 'Platform', imports: ['"time"'], code: 'go fmt.Print("worker ")\ntime.Sleep(100 * time.Millisecond)\nfmt.Println("main")', a: 'worker main', teaches: ['go', 'time', 'Sleep', 'Millisecond', 'Second'],
  learn: ['go in front of a call runs it at the same time as the rest of the program, as a goroutine. When main ends the whole program ends, even with goroutines still running. Sleep here only keeps main alive long enough, and later missions show the proper way.', 'go work()\ntime.Sleep(time.Second)\ntime.Sleep(100 * time.Millisecond)'],
  hints: ['The goroutine starts while main is sleeping.', 'Without the Sleep, main could exit before it printed.'], why: 'Goroutines are cheap to start, but main does not wait for them. That is the first concurrency trap.', job: 'Servers run each request in its own goroutine.' });
go({ title: 'Channels', from: 'Backend', code: 'ch := make(chan string, 2)\nch <- "a"\nch <- "b"\nfmt.Println(len(ch), <-ch, <-ch)', a: '2 a b', teaches: ['chan', '<-'],
  learn: ['A channel passes values between goroutines. ch <- v sends and <-ch receives, and values come out in order. An unbuffered channel blocks until the other side is ready. A buffered one holds a few values without blocking.', 'c := make(chan int, 1)\nc <- 5\nfmt.Println(<-c)   // 5'],
  hints: ['Two values are waiting when len runs.', 'They come out in the order they went in.'], why: 'Channels are how goroutines talk safely, by handing over values instead of sharing memory.', job: 'Pipelines and worker pools are built from channels.' });
go({ title: 'Close and drain', from: 'Backend', code: 'ch := make(chan int, 3)\nfor i := 1; i <= 3; i++ {\n\tch <- i * i\n}\nclose(ch)\nsum := 0\nfor v := range ch {\n\tsum += v\n}\nfmt.Println(sum, len(ch))', a: '14 0', teaches: ['close'],
  learn: ['close says no more values are coming. range on a channel reads what is left and then stops. Without close, that loop would wait forever.', 'c := make(chan int, 2)\nc <- 1\nclose(c)\nfor v := range c {\n\tfmt.Print(v)\n}'],
  hints: ['The buffer holds 3, so sends do not block.', 'range on a closed channel reads what is left.'], why: "Closing doesn't throw away buffered values. Without close, this loop would deadlock.", job: 'Worker pools use send, close and range.' });
go({ title: 'Select and timeouts', from: 'Backend', code: 'ch := make(chan int)\nselect {\ncase v := <-ch:\n\tfmt.Println(v)\ndefault:\n\tfmt.Println("empty")\n}', a: 'empty', teaches: ['select'],
  learn: ['select waits on several channels and runs whichever is ready first. A case on time.After gives you a timeout. With a default case it does not wait at all.', 'select {\ncase v := <-c:\n\tfmt.Print(v)\ncase <-time.After(time.Second):\n\tfmt.Print("too slow")\n}'],
  hints: ['Nothing is ready to send.', 'default runs when no case is ready.'], why: 'default makes a channel operation non-blocking, and time.After is how you stop waiting forever.', job: 'Handy for try-send and try-receive, and for every timeout.' });
go({ title: 'Share safely', from: 'Backend', imports: ['"sync"'], code: 'var mu sync.Mutex\nvar wg sync.WaitGroup\nn := 0\nfor i := 0; i < 100; i++ {\n\twg.Add(1)\n\tgo func() {\n\t\tdefer wg.Done()\n\t\tmu.Lock()\n\t\tn++\n\t\tmu.Unlock()\n\t}()\n}\nwg.Wait()\nfmt.Println(n)', a: '100', teaches: ['sync', 'Mutex', 'WaitGroup', 'Add', 'Done', 'Wait', 'Lock', 'Unlock'],
  learn: ['The sync package has the tools for this. WaitGroup waits for goroutines: Add before starting, Done when finished, Wait blocks until all are done. A Mutex lets only one goroutine at a time change shared data.', 'wg.Add(1)\ngo func() {\n\tdefer wg.Done()\n\tmu.Lock(); n++; mu.Unlock()\n}()\nwg.Wait()'],
  hints: ['The mutex protects n.', 'Wait blocks until every Done.'], why: 'WaitGroup waits for the goroutines, and the mutex stops lost updates. Without it the count could be wrong.', job: 'The basic shape of safe concurrent code.' });
go({ title: 'Cancel work', from: 'Backend', imports: ['"context"', '"time"'], code: 'ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)\ndefer cancel()\nselect {\ncase <-ctx.Done():\n\tfmt.Println(ctx.Err())\ncase <-time.After(time.Second):\n\tfmt.Println("finished")\n}', a: 'context deadline exceeded', teaches: ['context', 'WithTimeout', 'Background', 'After', 'Err'],
  learn: ['A context carries a deadline through your program. context.WithTimeout makes one that expires, and time.After is a channel that fires once after a delay. Its Done channel closes when time is up, and ctx.Err() says why. Always defer cancel().', 'ctx, cancel := context.WithTimeout(context.Background(), time.Second)\ndefer cancel()\n<-ctx.Done()\nfmt.Println(ctx.Err())'],
  hints: ['10 milliseconds is much shorter than one second.', 'The message for a timeout is "context deadline exceeded".'], why: 'Context lets a caller stop work it no longer needs, so a slow database cannot pile up requests forever.', job: 'Every Go server passes a context through each request.' });

ch('Quality');
go({ title: 'Table tests', from: 'Platform', decl: 'func double(x int) int { return x + x }\n', code: 'cases := []struct {\n\tname    string\n\tin, want int\n}{\n\t{"one", 1, 2},\n\t{"two", 2, 4},\n\t{"three", 3, 7},\n}\nfor _, c := range cases {\n\tif got := double(c.in); got != c.want {\n\t\tfmt.Println("FAIL", c.name)\n\t}\n}', a: 'FAIL three', teaches: ['table', 'testing'],
  learn: ['Go tests live in _test.go files and use the testing package. The common style is a table: a slice of cases, each with a name, an input and the wanted result, run in a loop. Adding a case is one more line.', 'for _, c := range cases {\n\tif got := f(c.in); got != c.want {\n\t\tt.Errorf("%s failed", c.name)\n\t}\n}'],
  hints: ['Work out double for each input.', 'Which row has a wrong want?'], why: 'Table tests separate the data from the logic, so covering a new edge case takes one line.', job: 'Most Go tests you read are written this way.' });
fix({ title: 'Capstone: the worker pool', from: 'CTO', imports: ['"sync"'], code: 'jobs := make(chan int, 5)\nresults := make(chan int, 5)\nvar wg sync.WaitGroup\nfor w := 0; w < 3; w++ {\n\twg.Add(1)\n\tgo func() {\n\t\tdefer wg.Done()\n\t\tfor j := range jobs {\n\t\t\tresults <- j * 2\n\t\t}\n\t}()\n}\nfor i := 1; i <= 5; i++ {\n\tjobs <- i\n}\n____\nwg.Wait()\nclose(results)\nsum := 0\nfor r := range results {\n\tsum += r\n}\nfmt.Println(sum)', fixes: ['close(jobs)'], prints: '30', teaches: ['capstone'],
  learn: ['Nothing new. A worker pool is goroutines ranging over a jobs channel. They only leave that loop when the channel is closed, and wg.Wait() only returns when they leave.', 'for j := range jobs {\n\t// stops when jobs is closed\n}'],
  brief: 'Three workers double each job. As written the program hangs forever at wg.Wait(). What line belongs in the blank?', hints: ['What ends a range over a channel?', 'The sender is finished at that point.'], why: 'range over a channel ends only on close. Whoever sends is responsible for closing, otherwise every worker waits forever.', job: 'You have just debugged the most common goroutine leak there is.' });
