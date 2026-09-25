/**
 * Front-end session — a demo gate, and nothing more.
 *
 * There is no authentication in this project. The FastAPI service has no user
 * table, issues no token, and enforces nothing. This module exists so the sign-in
 * page has somewhere honest to put its state, and it is deliberately named and
 * documented so that nobody later mistakes it for security.
 *
 * What it does NOT do:
 *   - send credentials anywhere
 *   - verify a password against anything
 *   - protect a route, an API call, or a byte of data
 *
 * Any client-side gate can be bypassed from a console in seconds. Treating this
 * as authentication would be worse than having no sign-in page at all, because it
 * would create the appearance of a control that does not exist.
 */

const STORAGE_KEY = 'thermal-shelter.demo-session';

export interface DemoSession {
  /** The address the visitor typed. Not verified, not sent anywhere. */
  email: string;
  /** Epoch milliseconds. */
  startedAt: number;
}

/**
 * Where the session lives.
 *
 * `localStorage` survives a browser restart; `sessionStorage` does not. The
 * sign-in form's "keep me signed in" checkbox maps onto exactly that difference,
 * so the control does something real rather than being decorative.
 */
function store(persist: boolean): Storage | null {
  if (typeof window === 'undefined') return null;
  return persist ? window.localStorage : window.sessionStorage;
}

export function readSession(): DemoSession | null {
  if (typeof window === 'undefined') return null;
  /* Either store may hold it; local is checked second so a remembered session
     wins over a stale per-tab one. */
  for (const backing of [window.sessionStorage, window.localStorage]) {
    try {
      const raw = backing.getItem(STORAGE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<DemoSession>;
      if (typeof parsed.email !== 'string' || typeof parsed.startedAt !== 'number') continue;
      return { email: parsed.email, startedAt: parsed.startedAt };
    } catch {
      /* A corrupt or blocked store must not break the page. */
    }
  }
  return null;
}

export function writeSession(email: string, persist = true): void {
  const target = store(persist);
  if (!target) return;
  /* Clear the other store first, so switching the checkbox cannot leave two
     sessions behind and make sign-out ambiguous. */
  clearSession();
  try {
    target.setItem(
      STORAGE_KEY,
      JSON.stringify({ email, startedAt: Date.now() } satisfies DemoSession),
    );
  } catch {
    /* Private-browsing quota errors are not worth surfacing here. */
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  for (const backing of [window.localStorage, window.sessionStorage]) {
    try {
      backing.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
