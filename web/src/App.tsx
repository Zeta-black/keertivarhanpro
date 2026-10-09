/**
 * App root: providers, the shell, the route switch and the error boundary.
 *
 * Screens are lazily loaded so the first paint only carries Discover plus the
 * shell. The 3D scene and the chart code ride along with the screens that use
 * them rather than blocking the landing page.
 */

import { Component, Suspense, lazy, useEffect, type ErrorInfo, type ReactNode } from 'react';

import { Shell } from './app/Shell';
import { RouterProvider, useRouter } from './app/router';
import { Button, LoadingState, Notice } from './components/primitives';
import { parseShareState } from './state/persistence';
import { StoreProvider, useStore } from './state/store';

import './styles/tokens.css';
import './styles/global.css';
import './styles/components.css';

const DiscoverScreen = lazy(() =>
  import('./screens/Discover').then((m) => ({ default: m.DiscoverScreen })),
);
const BuildScreen = lazy(() =>
  import('./screens/Build').then((m) => ({ default: m.BuildScreen })),
);
const OptimiseScreen = lazy(() =>
  import('./screens/Optimise').then((m) => ({ default: m.OptimiseScreen })),
);
const CompareScreen = lazy(() =>
  import('./screens/Compare').then((m) => ({ default: m.CompareScreen })),
);
const UnderstandScreen = lazy(() =>
  import('./screens/Understand').then((m) => ({ default: m.UnderstandScreen })),
);
const ResultsScreen = lazy(() =>
  import('./screens/Results').then((m) => ({ default: m.ResultsScreen })),
);

/**
 * Catches a render crash in one screen so the rest of the site keeps working.
 * Without this a single bad chart would blank the whole page.
 */
class ScreenErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode; onReset: () => void }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No telemetry: this is logged locally so a developer can see it, nothing more.
    console.error('QBind Select screen error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="shell" style={{ paddingBlock: 'var(--s-7)' }}>
          <Notice tone="honest" icon="!">
            <strong>This screen hit an error and stopped rendering.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>
              The rest of the site still works. The error was:{' '}
              <code>{this.state.error.message}</code>
            </p>
            <div className="row-wrap" style={{ marginTop: 'var(--s-3)' }}>
              <Button
                variant="primary"
                onClick={() => {
                  this.setState({ error: null });
                  this.props.onReset();
                }}
              >
                Try this screen again
              </Button>
              <Button onClick={() => window.location.reload()}>Reload the page</Button>
            </div>
          </Notice>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Applies a shared design from the URL hash, once, on first load. */
function ShareStateLoader(): null {
  const { dispatch } = useStore();

  useEffect(() => {
    if (!window.location.hash) return;
    const parsed = parseShareState(window.location.hash);
    if (parsed.codes) {
      dispatch({ type: 'SET_DRAFT', codes: parsed.codes, recordHistory: false });
    }
    if (parsed.lambda !== null) {
      dispatch({ type: 'SET_LAMBDA', lambda: parsed.lambda });
    }
    if (parsed.errors.length > 0) {
      // Malformed links are ignored rather than fatal; the reason is logged.
      console.warn('QBind Select share link issues:', parsed.errors);
    }
  }, [dispatch]);

  return null;
}

function Routes(): JSX.Element {
  const { screen } = useRouter();

  const content = (() => {
    switch (screen) {
      case 'build':
        return <BuildScreen />;
      case 'optimise':
        return <OptimiseScreen />;
      case 'compare':
        return <CompareScreen />;
      case 'understand':
        return <UnderstandScreen />;
      case 'results':
        return <ResultsScreen />;
      case 'discover':
      default:
        return <DiscoverScreen />;
    }
  })();

  return (
    <ScreenErrorBoundary key={screen} onReset={() => undefined}>
      <Suspense
        fallback={
          <div className="shell" style={{ paddingBlock: 'var(--s-8)' }}>
            <LoadingState title="Loading this screen" fraction={null} />
          </div>
        }
      >
        {content}
      </Suspense>
    </ScreenErrorBoundary>
  );
}

export default function App(): JSX.Element {
  return (
    <StoreProvider>
      <RouterProvider>
        <ShareStateLoader />
        <Shell>
          <Routes />
        </Shell>
      </RouterProvider>
    </StoreProvider>
  );
}
