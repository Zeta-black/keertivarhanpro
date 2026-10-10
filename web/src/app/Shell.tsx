/**
 * The persistent shell: skip link, navigation, context bar, help, tour and the
 * global error surface. Everything that must be present on every screen.
 */

import { useEffect, useRef, useState } from 'react';

import {
  Button,
  Modal,
  Notice,
  Segmented,
} from '../components/primitives';
import {
  ACCESSIBILITY_STATEMENT,
  FAQ,
  JARGON,
  KEYBOARD_SHORTCUTS,
  NAV_ORDER,
  SCREENS,
  SITE,
  TOUR_STEPS,
} from '../content/copy';
import { useStore } from '../state/store';
import { ScreenLink, useRouter } from './router';

export function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  const { state, dispatch } = useStore();
  const { screen } = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);

  // The tour is offered, never forced. A dialog that opens itself over the
  // first thing a visitor looks at costs more than it teaches, so it is a
  // button in the header instead and the "new here?" hint only appears on the
  // landing screen on a genuine first visit.
  const offerTour = !state.tourSeen && screen === 'discover';

  // Global shortcuts. Never hijack typing in an input.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (typing) return;

      if (event.key === '?') {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        if (tourStep !== null) {
          setTourStep(null);
          dispatch({ type: 'TOUR_SEEN' });
        }
        setHelpOpen(false);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'REDO' : 'UNDO' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, tourStep]);

  const closeTour = () => {
    setTourStep(null);
    dispatch({ type: 'TOUR_SEEN' });
    // The tour opens on its own, so there is no prior focus to restore. Without
    // an explicit target, dismissing it leaves focus on a removed node and the
    // browser drops it somewhere arbitrary - which also meant the next Tab did
    // not reach the skip link. Send focus to the main landmark instead.
    window.requestAnimationFrame(() => {
      document.getElementById('main')?.focus();
    });
  };

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <nav className="app-nav no-print" aria-label="Main">
        <div className="shell app-nav-inner">
          <ScreenLink
            to="discover"
            className="row"
            style={{ textDecoration: 'none', color: 'var(--text-strong)', flex: 'none' }}
            aria-label={`${SITE.name} home`}
          >
            <Logo />
            <span
              style={{
                fontWeight: 700,
                letterSpacing: 'var(--tracking-tight)',
                fontSize: 'var(--fs-md)',
              }}
            >
              QBind<span style={{ color: 'var(--accent)' }}>Select</span>
            </span>
          </ScreenLink>

          <ul className="nav-links">
            {NAV_ORDER.map((id, index) => (
              <li key={id}>
                <ScreenLink to={id} className="nav-link">
                  <span className="nav-link-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  {SCREENS[id].nav}
                </ScreenLink>
              </li>
            ))}
          </ul>

          <div className="row" style={{ flex: 'none', gap: 'var(--s-2)' }}>
            <Segmented
              label="Explanation detail"
              value={state.mode}
              onChange={(mode) => dispatch({ type: 'SET_MODE', mode })}
              options={[
                {
                  value: 'beginner',
                  label: 'Beginner',
                  hint: 'Plain language, equations hidden',
                },
                {
                  value: 'researcher',
                  label: 'Researcher',
                  hint: 'Equations, raw coefficients and methodology shown',
                },
              ]}
            />
            <Button
              variant="ghost"
              iconOnly
              onClick={() =>
                dispatch({
                  type: 'SET_THEME',
                  theme: state.theme === 'light' ? 'dark' : 'light',
                })
              }
              aria-label={`Switch to ${state.theme === 'light' ? 'dark' : 'light'} theme`}
              title={`Switch to ${state.theme === 'light' ? 'dark' : 'light'} theme`}
            >
              <ThemeGlyph light={state.theme === 'light'} />
            </Button>
            <Button
              variant={offerTour ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTourStep(0)}
              title="A five-step walkthrough of what this tool does"
              // The visible label shortens on a phone, so the accessible name
              // is stated explicitly and stays the same at every width.
              aria-label="Take the guided tour"
            >
              {/* The invitation is worth the width on a desktop header and is
                  not worth it on a phone, where the same button is one of five
                  competing for one row. */}
              {offerTour ? <span className="tour-invite">New here?&nbsp;</span> : null}
              Tour
            </Button>
            <Button
              variant="ghost"
              iconOnly
              onClick={() => setHelpOpen(true)}
              aria-label="Help, shortcuts and frequently asked questions"
              title="Help (press ?)"
            >
              <span style={{ fontWeight: 700 }}>?</span>
            </Button>
          </div>
        </div>
      </nav>

      <ContextBar />

      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        {state.error && state.error.fatal ? (
          <div className="shell" style={{ paddingTop: 'var(--s-5)' }}>
            <Notice tone="honest" icon="!">
              <strong>Something went wrong and the app cannot compute.</strong>
              <p style={{ marginTop: 'var(--s-1)' }}>{state.error.message}</p>
              <div className="row" style={{ marginTop: 'var(--s-3)' }}>
                <Button variant="primary" onClick={() => window.location.reload()}>
                  Reload the page
                </Button>
                <Button onClick={() => dispatch({ type: 'DISMISS_ERROR' })}>
                  Dismiss and continue reading
                </Button>
              </div>
            </Notice>
          </div>
        ) : null}
        {children}
      </main>

      <SiteFooter onOpenHelp={() => setHelpOpen(true)} />

      {helpOpen ? <HelpModal onClose={() => setHelpOpen(false)} /> : null}
      {tourStep !== null ? (
        <TourOverlay
          step={tourStep}
          onNext={() =>
            tourStep + 1 >= TOUR_STEPS.length ? closeTour() : setTourStep(tourStep + 1)
          }
          onBack={() => setTourStep(Math.max(0, tourStep - 1))}
          onSkip={closeTour}
        />
      ) : null}
    </>
  );
}

/** The always-visible answer to "what am I looking at?". */
function ContextBar(): JSX.Element {
  const { state, cancelRun } = useStore();
  const { screen } = useRouter();

  const dataLabel =
    state.dataMode === 'live'
      ? 'Showing your live run'
      : state.dataMode === 'replay'
        ? 'Showing the recorded reference run'
        : 'No run yet - nothing has been computed in this session';

  return (
    <nav
      className="no-print"
      aria-label="Breadcrumb and run status"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--surface-sunken)',
      }}
    >
      <div
        className="shell row-wrap"
        style={{
          justifyContent: 'space-between',
          paddingBlock: 'var(--s-2)',
          fontSize: 'var(--fs-xs)',
          gap: 'var(--s-3)',
        }}
      >
        <ol className="breadcrumbs" style={{ margin: 0 }}>
          <li>QBind Select</li>
          <li aria-current="page">{SCREENS[screen].nav}</li>
        </ol>
        <div className="row-wrap" style={{ gap: 'var(--s-3)' }} role="status">
          <span className="muted">{dataLabel}</span>
          {state.status === 'running' ? (
            <>
              <span className="row" style={{ gap: 'var(--s-1)', color: 'var(--optimise)' }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: 'var(--optimise)',
                  }}
                />
                computing
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={cancelRun}>
                Cancel
              </button>
            </>
          ) : null}
          {state.dataMode !== 'none' ? (
            <span className="muted num">
              priority {state.lambda} &middot; seed {state.config.seed}
            </span>
          ) : null}
        </div>
      </div>
    </nav>
  );
}

function SiteFooter({ onOpenHelp }: { readonly onOpenHelp: () => void }): JSX.Element {
  return (
    <footer
      style={{
        borderTop: '1px solid var(--border-subtle)',
        marginTop: 'var(--s-9)',
        paddingBlock: 'var(--s-6)',
        background: 'var(--surface-sunken)',
      }}
    >
      <div className="shell stack">
        {/* One line, stated once. The full scientific-validity assessment is a
            section at the bottom of Results and appears nowhere else, so the
            reader meets it in one place with its evidence rather than as a
            badge repeated on every screen. */}
        <p className="footer-disclosure">
          Computational predictions only &mdash; no laboratory validation, and no quantum
          hardware was used at any point.{' '}
          <ScreenLink to="results">Read the full scientific-validity assessment</ScreenLink>.
        </p>
        {/* A one-line glossary, on every screen. Someone who deep-links into
            /build or /results meets the words "peptide" and "selectivity
            priority" before they have ever seen the landing page. */}
        <dl
          className="row-wrap"
          style={{
            gap: 'var(--s-5)',
            fontSize: 'var(--fs-xs)',
            margin: 0,
            paddingBlock: 'var(--s-3)',
            borderBlock: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <dt style={{ fontWeight: 600, color: 'var(--text-strong)', display: 'inline' }}>
              Peptide:{' '}
            </dt>
            <dd className="muted" style={{ display: 'inline', margin: 0 }}>
              {JARGON.peptide.plain}. Here, always eight blocks long.
            </dd>
          </div>
          <div>
            <dt style={{ fontWeight: 600, color: 'var(--text-strong)', display: 'inline' }}>
              Selectivity Priority:{' '}
            </dt>
            <dd className="muted" style={{ display: 'inline', margin: 0 }}>
              {JARGON.lambda.plain}.
            </dd>
          </div>
          <div>
            <dt style={{ fontWeight: 600, color: 'var(--text-strong)', display: 'inline' }}>
              Model score:{' '}
            </dt>
            <dd className="muted" style={{ display: 'inline', margin: 0 }}>
              a dimensionless prediction used to rank designs, not a measured binding strength.
            </dd>
          </div>
        </dl>
        <div
          className="row-wrap"
          style={{ justifyContent: 'space-between', fontSize: 'var(--fs-xs)' }}
        >
          <span className="faint">
            {SITE.name} &mdash; an open, offline-capable research demonstration. No account, no
            tracking, no data leaves your browser.
          </span>
          <div className="row-wrap" style={{ gap: 'var(--s-4)' }}>
            <ScreenLink to="understand">Methodology</ScreenLink>
            <ScreenLink to="understand">Accessibility</ScreenLink>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenHelp}>
              Help and FAQ
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}

function HelpModal({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<'faq' | 'keys' | 'access'>('faq');

  return (
    <Modal title="Help" onClose={onClose}>
      <div className="stack">
        <Segmented
          label="Help section"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'faq', label: 'Questions' },
            { value: 'keys', label: 'Shortcuts' },
            { value: 'access', label: 'Accessibility' },
          ]}
        />

        {tab === 'faq' ? (
          <dl className="stack">
            {FAQ.map((item) => (
              <div key={item.q}>
                <dt style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{item.q}</dt>
                <dd
                  className="muted"
                  style={{ margin: '4px 0 0', fontSize: 'var(--fs-sm)' }}
                >
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {tab === 'keys' ? (
          <table className="table">
            <caption className="sr-only">Keyboard shortcuts</caption>
            <thead>
              <tr>
                <th scope="col">Keys</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {KEYBOARD_SHORTCUTS.map((item) => (
                <tr key={item.keys}>
                  <td>
                    <kbd>{item.keys}</kbd>
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>{item.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === 'access' ? (
          <div className="stack">
            {ACCESSIBILITY_STATEMENT.body.map((paragraph) => (
              <p key={paragraph} className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                {paragraph}
              </p>
            ))}
            <div className="row-wrap">
              <Segmented
                label="Animation"
                value={state.motion}
                onChange={(motion) => dispatch({ type: 'SET_MOTION', motion })}
                options={[
                  { value: 'system', label: 'Follow my system' },
                  { value: 'reduced', label: 'Reduce animation' },
                ]}
              />
              <Segmented
                label="Theme"
                value={state.theme}
                onChange={(theme) => dispatch({ type: 'SET_THEME', theme })}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
              />
            </div>
            <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
              Render quality on this device: {state.capability.tier === 'full' ? 'full' : 'lightweight'}.{' '}
              {state.capability.reason}
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * The first-run micro-tour. It is a dialog rather than a spotlight overlay so it
 * works identically on a phone, with a keyboard, and with a screen reader, and
 * cannot obscure the element it is describing.
 */
function TourOverlay({
  step,
  onNext,
  onBack,
  onSkip,
}: {
  readonly step: number;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onSkip: () => void;
}): JSX.Element {
  const current = TOUR_STEPS[step];
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    // Bring the element this step talks about into view.
    document
      .querySelector(`[data-tour="${current.target}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [current.target]);

  return (
    <div
      className="tour-overlay no-print"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'var(--s-5)',
        zIndex: 190,
        width: 'min(560px, calc(100vw - 2rem))',
      }}
    >
      <div
        ref={panelRef}
        className="card card-raised"
        role="dialog"
        aria-modal="false"
        aria-label={`Quick tour, step ${step + 1} of ${TOUR_STEPS.length}`}
        style={{ borderColor: 'var(--accent)', boxShadow: 'var(--shadow-glow)' }}
      >
        <div className="spread" style={{ marginBottom: 'var(--s-2)' }}>
          <span className="eyebrow">
            Quick tour &middot; {step + 1} of {TOUR_STEPS.length}
          </span>
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Skip
          </Button>
        </div>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>{current.title}</h2>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-2)' }}>
          {current.body}
        </p>
        <div className="row" style={{ marginTop: 'var(--s-4)' }}>
          <Button onClick={onBack} disabled={step === 0}>
            Back
          </Button>
          <Button variant="primary" onClick={onNext}>
            {step + 1 >= TOUR_STEPS.length ? 'Start exploring' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Logo(): JSX.Element {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="14" cy="14" r="12.2" stroke="var(--accent)" strokeWidth="1.4" opacity="0.4" />
      <ellipse
        cx="14"
        cy="14"
        rx="12.2"
        ry="5"
        stroke="var(--accent)"
        strokeWidth="1.2"
        opacity="0.6"
        transform="rotate(-28 14 14)"
      />
      <circle cx="8.4" cy="10.4" r="2.5" fill="var(--c-arom-w)" />
      <circle cx="19.2" cy="12.4" r="2.1" fill="var(--c-hydrophobic)" />
      <circle cx="13" cy="19.4" r="2.3" fill="var(--c-small-polar)" />
    </svg>
  );
}

function ThemeGlyph({ light }: { readonly light: boolean }): JSX.Element {
  return light ? (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4.6" stroke="currentColor" strokeWidth="1.8" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <line
          key={angle}
          x1="12"
          y1="2.6"
          x2="12"
          y2="5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
