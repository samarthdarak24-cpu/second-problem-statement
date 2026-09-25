import { AppShell } from '@/components/shell/AppShell';

/**
 * Layout for the whole workspace.
 *
 * A route group — `(app)` does not appear in the URL — so every page below it
 * shares one shell and one set of boot behaviour without repeating either.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
