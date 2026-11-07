/* Builds the program a Python mission runs: the player's code, the mission's scaffolding and the
   tests. No DOM, so tools/verify_content.mjs runs the exact same text under python3 and Skulpt. */

/* print is replaced so a test can check what the program printed. */
const CAPTURE = `_o = []
_print = print
def print(*a, sep=" ", end="\\n"):
    _o.append(sep.join([str(x) for x in a]) + end)
def _printed():
    return "".join(_o)
`;
const HARNESS = `
_fails = 0
def _t(name, got, want):
    global _fails
    if got == want and type(got) == type(want):
        _print("ok   " + name)
    else:
        _fails = _fails + 1
        _print("FAIL " + name + ": got " + repr(got) + ", wanted " + repr(want))
`;

export function buildProgram(mission, src) {
  const head = mission.captureOutput ? CAPTURE : '_print = print\n';
  let body = src;
  let extra = 0;
  if (mission.wrap) {
    // The player's lines become a function body, so one solution can be tried on many inputs.
    const inner = src.split('\n').map((l) => `    ${l}`).join('\n');
    body = `def __case(${mission.wrap.args}):\n${inner}\n    return ${mission.wrap.ret}\n`;
    extra = 1;
  }
  const tests = mission.tests.map((x) => {
    const name = JSON.stringify(x[2] || x[0]);
    return `_t(${name}, ${x[0]}, ${x[1]})`;
  }).join('\n');
  const text = `${head}${body}\n${mission.prelude || ''}${HARNESS}${tests}\n_print("ALL_PASSED" if _fails == 0 else "SOME_FAILED")\n`;
  return { text, offset: head.split('\n').length - 1 + extra };
}

export function judge(run, offset) {
  const out = run.out.replace(/ on line (\d+)/g, (_, n) => ` on line ${Math.max(1, Number(n) - offset)}`);
  return { passed: run.ok && /ALL_PASSED/.test(run.out), out: out.replace(/ALL_PASSED|SOME_FAILED/, '').trim() };
}

/* Skulpt has no json module, so the browser gets this small faithful one. Real python3 uses its own. */
export const JSON_MODULE = `
def _ws(s, i):
    while i < len(s) and s[i] in " \\t\\r\\n":
        i += 1
    return i

def _value(s, i):
    i = _ws(s, i)
    if i >= len(s):
        raise ValueError("Expecting value")
    c = s[i]
    if c == "{":
        out = {}
        i = _ws(s, i + 1)
        if s[i] == "}":
            return out, i + 1
        while True:
            k, i = _value(s, i)
            i = _ws(s, i)
            if s[i] != ":":
                raise ValueError("Expecting ':' delimiter")
            v, i = _value(s, i + 1)
            out[k] = v
            i = _ws(s, i)
            if s[i] == "}":
                return out, i + 1
            if s[i] != ",":
                raise ValueError("Expecting ',' delimiter")
            i += 1
    if c == "[":
        out = []
        i = _ws(s, i + 1)
        if s[i] == "]":
            return out, i + 1
        while True:
            v, i = _value(s, i)
            out.append(v)
            i = _ws(s, i)
            if s[i] == "]":
                return out, i + 1
            if s[i] != ",":
                raise ValueError("Expecting ',' delimiter")
            i += 1
    if c == '"':
        i += 1
        t = ""
        while s[i] != '"':
            if s[i] == "\\\\":
                i += 1
                t += {"n": "\\n", "t": "\\t", "r": "\\r"}.get(s[i], s[i])
            else:
                t += s[i]
            i += 1
        return t, i + 1
    for word, val in [("true", True), ("false", False), ("null", None)]:
        if s[i:i + len(word)] == word:
            return val, i + len(word)
    j = i
    while j < len(s) and s[j] in "+-0123456789.eE":
        j += 1
    if j == i:
        raise ValueError("Expecting value")
    n = s[i:j]
    return (float(n) if "." in n or "e" in n or "E" in n else int(n)), j

def loads(s):
    v, i = _value(s, 0)
    if _ws(s, i) != len(s):
        raise ValueError("Extra data")
    return v

def _text(s):
    return '"' + s.replace("\\\\", "\\\\\\\\").replace('"', '\\\\"').replace("\\n", "\\\\n").replace("\\t", "\\\\t") + '"'

def dumps(o):
    if o is None:
        return "null"
    if o is True:
        return "true"
    if o is False:
        return "false"
    if isinstance(o, str):
        return _text(o)
    if isinstance(o, (int, float)):
        return str(o)
    if isinstance(o, dict):
        return "{" + ", ".join([_text(str(k)) + ": " + dumps(v) for k, v in o.items()]) + "}"
    if isinstance(o, (list, tuple)):
        return "[" + ", ".join([dumps(v) for v in o]) + "]"
    raise TypeError("Object is not JSON serializable")
`;

/* Module and file lookup for Skulpt: our json, the mission's files, then the standard library. */
function skulptReader(Sk, mission) {
  return (f) => {
    if (f === 'src/lib/json/__init__.py') return JSON_MODULE;
    const clean = f.replace(/^\.\//, '');
    if (mission?.files?.[clean] !== undefined) return mission.files[clean];
    if (Sk.builtinFiles === undefined || Sk.builtinFiles.files[f] === undefined) throw new Error('File not found: ' + f);
    return Sk.builtinFiles.files[f];
  };
}

/* One setup for the browser and for tools/verify_content.mjs, so they can't drift apart. */
export function configureSkulpt(Sk, mission, output) {
  // Skulpt works this out on load and configure() can't change it. Left true, open() looks for
  // elements on the page instead of asking read() for the mission's files.
  Sk.inBrowser = false;
  Sk.configure({ output, read: skulptReader(Sk, mission), __future__: Sk.python3, execLimit: 4000 });
}
