/**
 * A tiny History-API router.
 *
 * Why not react-router: this app has six routes and no nested layouts or data
 * loaders. ~90 lines here replaces a dependency, keeps the bundle small, and
 * lets me guarantee the exact browser-back behaviour the release gate asks for.
 *
 * It honours Vite's `base`, so the same build works at a domain root and at a
 * GitHub Pages sub-path.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { NAV_ORDER, SCREENS, type ScreenId } from '../content/copy';

/** Vite injects BASE_URL; it always has a trailing slash. */
const BASE = import.meta.env.BASE_URL || '/';

function stripBase(pathname: string): string {
  if (BASE !== '/' && pathname.startsWith(BASE)) {
    return `/${pathname.slice(BASE.length)}`.replace(/\/{2,}/g, '/');
  }
  return pathname;
}

export function toHref(path: string): string {
  if (BASE === '/') return path;
  return `${BASE.replace(/\/$/, '')}${path}`;
}

export function screenIdFor(pathname: string): ScreenId {
  const path = stripBase(pathname).replace(/\/+$/, '') || '/';
  const found = NAV_ORDER.find((id) => SCREENS[id].path === path);
  return found ?? 'discover';
}

interface RouterApi {
  readonly screen: ScreenId;
  readonly navigate: (screen: ScreenId, options?: { replace?: boolean }) => void;
  readonly hash: string;
}

const RouterContext = createContext<RouterApi | null>(null);

export function RouterProvider({ children }: { children: ReactNode }): JSX.Element {
  const [location, setLocation] = useState(() => ({
    pathname: window.location.pathname,
    hash: window.location.hash,
  }));

  useEffect(() => {
    const onPopState = () => {
      setLocation({ pathname: window.location.pathname, hash: window.location.hash });
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onPopState);
    };
  }, []);

  const navigate = useCallback((screen: ScreenId, options?: { replace?: boolean }) => {
    const url = toHref(SCREENS[screen].path) + window.location.hash;
    if (options?.replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
    setLocation({ pathname: window.location.pathname, hash: window.location.hash });
    // A route change must move the reading position and the focus target, or a
    // keyboard user stays stranded at the bottom of the previous screen.
    window.scrollTo({ top: 0, behavior: 'auto' });
    window.requestAnimationFrame(() => {
      document.getElementById('main')?.focus();
    });
  }, []);

  const screen = screenIdFor(location.pathname);

  useEffect(() => {
    document.title = `${SCREENS[screen].title} - QBind Select`;
  }, [screen]);

  const api = useMemo<RouterApi>(
    () => ({ screen, navigate, hash: location.hash }),
    [screen, navigate, location.hash],
  );

  return <RouterContext.Provider value={api}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterApi {
  const api = useContext(RouterContext);
  if (!api) throw new Error('useRouter must be used inside <RouterProvider>');
  return api;
}

/** An anchor that keeps real link semantics (middle-click, copy link) but routes in-app. */
export function ScreenLink({
  to,
  children,
  className,
  onNavigate,
  ...rest
}: {
  readonly to: ScreenId;
  readonly children: ReactNode;
  readonly className?: string;
  readonly onNavigate?: () => void;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>): JSX.Element {
  const { screen, navigate } = useRouter();
  const isCurrent = screen === to;
  return (
    <a
      href={toHref(SCREENS[to].path)}
      className={className}
      aria-current={isCurrent ? 'page' : undefined}
      onClick={(event) => {
        // Let the browser handle modified clicks so "open in new tab" works.
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        navigate(to);
        onNavigate?.();
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
