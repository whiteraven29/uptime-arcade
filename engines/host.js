/* The seam between engines and whatever hosts them (the React app, tests, the M9 runner).
   S is mutated in place and never reassigned, so every engine sees the same object.
   Hosts replace the hooks to receive errors and vi lifecycle events. */
export const S = { cwd: '/home/ops', overlay: {}, hist: [], viKeys: {}, net: { gw: '10.40.3.1' }, ranScript: false };

export const host = {
  err() {},
  viShow() {},
  afterVi() {},
};

/** Swap the whole save in without breaking references held by engines. */
export function replaceState(next) {
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, next);
}
