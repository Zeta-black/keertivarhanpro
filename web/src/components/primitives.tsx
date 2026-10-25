/**
 * Shared UI primitives. Every screen composes these, so interaction and
 * accessibility behaviour is defined once rather than per screen.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

import { PROVENANCE_LABEL, PROVENANCE_MEANING, type Provenance } from '../state/types';
import { groupInt } from '../content/format';

/* ------------------------------------------------------------------ *
 * Card
 * ------------------------------------------------------------------ */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly raised?: boolean;
  readonly interactive?: boolean;
  readonly selected?: boolean;
}

export function Card({
  raised,
  interactive,
  selected,
  className = '',
  children,
  ...rest
}: CardProps): JSX.Element {
  const classes = [
    'card',
    raised ? 'card-raised' : '',
    interactive ? 'card-interactive' : '',
    selected ? 'card-selected' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  readonly size?: 'sm' | 'md' | 'lg';
  readonly iconOnly?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  iconOnly,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const classes = [
    'btn',
    `btn-${variant}`,
    size === 'lg' ? 'btn-lg' : size === 'sm' ? 'btn-sm' : '',
    iconOnly ? 'btn-icon' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Provenance badge - says where a number came from.
 * ------------------------------------------------------------------ */
export function ProvenanceBadge({
  kind,
  detail,
}: {
  readonly kind: Provenance;
  readonly detail?: string;
}): JSX.Element {
  const title = `${PROVENANCE_LABEL[kind]}: ${detail ?? PROVENANCE_MEANING[kind]}`;
  return (
    <span className={`badge badge-prov prov-${kind}`} title={title}>
      <span className="sr-only">Data provenance: </span>
      {PROVENANCE_LABEL[kind]}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Info tooltip. Works on hover, focus, click and touch, and is
 * announced to screen readers rather than being hover-only.
 * ------------------------------------------------------------------ */
export function InfoTip({
  title,
  body,
  label,
}: {
  readonly title: string;
  readonly body: string;
  readonly label?: string;
}): JSX.Element {
  // `pinned` is a click; `hovering` is a pointer or focus pass. Keeping them
  // apart is what stops a tip you deliberately opened from vanishing the
  // moment the pointer drifts off the 18px button.
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const open = pinned || hovering;

  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);

  const close = useCallback(() => {
    setPinned(false);
    setHovering(false);
  }, []);

  /**
   * Position the tip in viewport coordinates.
   *
   * It is `position: fixed`, not absolute, for two reasons. An absolutely
   * positioned tip is clipped by any scrolling ancestor - and several of these
   * buttons sit inside `.scroll-x` tables, where the tip was being cut off.
   * And with a containing block only as wide as the button, shrink-to-fit
   * collapsed the tip to its longest word, which is what produced the narrow
   * vertical column of text. Fixed positioning plus an explicit width in CSS
   * removes both problems.
   */
  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    const place = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      const tip = tipRef.current;
      if (!anchor || !tip) return;
      const gap = 8;
      const margin = 12;
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Start aligned to the button, then pull back inside both edges.
      let left = anchor.left;
      if (left + width > viewportWidth - margin) left = viewportWidth - margin - width;
      if (left < margin) left = margin;

      // Below by default. Flip above only when below genuinely does not fit
      // and above does, so the tip does not jump around unnecessarily.
      let top = anchor.bottom + gap;
      const fitsBelow = top + height <= viewportHeight - margin;
      const fitsAbove = anchor.top - gap - height >= margin;
      if (!fitsBelow && fitsAbove) top = anchor.top - gap - height;
      else if (!fitsBelow) top = Math.max(margin, viewportHeight - margin - height);

      setBox({ left, top });
    };

    place();
    // `true` captures scrolls on inner containers too, not just the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, title, body]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (tipRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Deliberately does NOT move focus. The button is already the focused
      // element for a keyboard user - that is how the tip was opened - and
      // calling focus() here re-fired onFocus, which set `hovering` again and
      // reopened the tip Escape had just dismissed.
      close();
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('touchstart', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('touchstart', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <span ref={wrapRef} className="infotip-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="info-btn"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        aria-label={label ?? `What is ${title}?`}
        onClick={() => {
          setPinned((was) => !was);
          setHovering(false);
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
      >
        i
      </button>
      {open ? (
        <span
          ref={tipRef}
          id={id}
          role="tooltip"
          className="tooltip"
          style={{
            left: box ? `${box.left}px` : 0,
            top: box ? `${box.top}px` : 0,
            // Hidden for the one frame before it has been measured, so it is
            // never seen in the wrong place.
            visibility: box ? 'visible' : 'hidden',
          }}
        >
          <span className="tooltip-title">{title}</span>
          <span>{body}</span>
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Stat tile. A number is never shown without a label, a unit and a
 * direction, because an unexplained number is the main thing that made
 * the old interface unreadable.
 * ------------------------------------------------------------------ */
export interface StatProps {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly help?: string;
  readonly direction?: string;
  readonly tone?: 'pet' | 'pe' | 'pp' | 'good' | 'warn' | 'plain';
  readonly delta?: { value: number; betterWhen: 'higher' | 'lower' } | null;
  readonly provenance?: Provenance;
}

export function Stat({
  label,
  value,
  unit,
  help,
  direction,
  tone = 'plain',
  delta,
  provenance,
}: StatProps): JSX.Element {
  const toneClass = tone === 'plain' ? '' : `stat-${tone}`;
  return (
    <div className={`stat ${toneClass}`}>
      <div className="stat-label">
        <span>{label}</span>
        {help ? <InfoTip title={label} body={help} /> : null}
      </div>
      <div className="row" style={{ gap: 'var(--s-2)', flexWrap: 'wrap' }}>
        <span className="stat-value">{value}</span>
        {delta ? <DeltaChip value={delta.value} betterWhen={delta.betterWhen} /> : null}
      </div>
      {unit || direction ? (
        <div className="stat-unit">
          {unit}
          {unit && direction ? ' - ' : ''}
          {direction}
        </div>
      ) : null}
      {provenance ? (
        <div style={{ marginTop: 'var(--s-2)' }}>
          <ProvenanceBadge kind={provenance} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * A row of statistics that share a provenance.
 *
 * Repeating the same badge on every tile in a row says one thing four times
 * and trains the reader to stop seeing it. The group states it once; an
 * individual `Stat` keeps its own `provenance` prop for the case where one
 * tile really does differ from its neighbours.
 */
export function StatGroup({
  provenance,
  note,
  children,
}: {
  readonly provenance: Provenance;
  readonly note?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className="stat-group">
      <div className="stat-group-head">
        <ProvenanceBadge kind={provenance} detail={note} />
        {note ? <span className="stat-group-note">{note}</span> : null}
      </div>
      <div className="grid-auto">{children}</div>
    </div>
  );
}

/** A change chip that knows which direction counts as an improvement. */
export function DeltaChip({
  value,
  betterWhen,
  digits = 2,
}: {
  readonly value: number;
  readonly betterWhen: 'higher' | 'lower';
  readonly digits?: number;
}): JSX.Element {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-9) {
    return (
      <span className="delta delta-flat">
        <span aria-hidden="true">=</span>
        <span className="sr-only">no change</span>
      </span>
    );
  }
  const improved = betterWhen === 'higher' ? value > 0 : value < 0;
  const sign = value > 0 ? '+' : '-';
  return (
    <span className={`delta ${improved ? 'delta-up' : 'delta-down'}`}>
      <span aria-hidden="true">{value > 0 ? '▲' : '▼'}</span>
      <span>
        {sign}
        {Math.abs(value).toFixed(digits)}
      </span>
      <span className="sr-only">{improved ? ', an improvement' : ', worse'}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Disclosure. The mechanism that lets one page serve a beginner and a
 * reviewer without splitting the underlying truth.
 * ------------------------------------------------------------------ */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  readonly summary: string;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="disclosure" data-open={open}>
      <button
        type="button"
        className="disclosure-summary"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          className="disclosure-caret"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path d="M4 2l5 4-5 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {summary}
      </button>
      <div id={id} className="disclosure-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Status boxes. Loading, empty and error are first-class states, not
 * blank space.
 * ------------------------------------------------------------------ */
export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
}): JSX.Element {
  return (
    <div className="state-box">
      {icon ?? <OrbitGlyph />}
      <p className="state-title">{title}</p>
      <p className="state-body">{body}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
}): JSX.Element {
  return (
    <div className="state-box state-error" role="alert">
      <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="var(--danger)" strokeWidth="1.6" />
        <path d="M12 7.5v6" stroke="var(--danger)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="16.6" r="0.9" fill="var(--danger)" />
      </svg>
      <p className="state-title">{title}</p>
      <p className="state-body">{body}</p>
      {action}
    </div>
  );
}

export function LoadingState({
  title,
  body,
  fraction,
}: {
  readonly title: string;
  readonly body?: string;
  readonly fraction?: number | null;
}): JSX.Element {
  const measurable = typeof fraction === 'number' && Number.isFinite(fraction);
  return (
    <div className="state-box" role="status" aria-live="polite">
      <OrbitGlyph spinning />
      <p className="state-title">{title}</p>
      {body ? <p className="state-body">{body}</p> : null}
      <div
        className={`progress ${measurable ? '' : 'progress-indeterminate'}`}
        style={{ width: 'min(320px, 100%)' }}
        role="progressbar"
        aria-valuenow={measurable ? Math.round(fraction * 100) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={title}
      >
        <div
          className="progress-fill"
          style={{ width: measurable ? `${Math.round(fraction * 100)}%` : undefined }}
        />
      </div>
      {measurable ? (
        <span className="faint num" style={{ fontSize: 'var(--fs-xs)' }}>
          {(fraction * 100).toFixed(1)}%
        </span>
      ) : (
        <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
          Working. This step does not report a percentage, so elapsed time is shown instead.
        </span>
      )}
    </div>
  );
}

/**
 * The mark used by loading and empty states.
 *
 * Deliberately NOT an orbiting-electron atom: that motif is a picture of a
 * physical model this project does not use, and an animated one implies
 * activity that is not happening. This is an eight-cell row - the eight
 * positions of a design - which is a shape the product actually means.
 */
export function OrbitGlyph({ spinning = false }: { readonly spinning?: boolean }): JSX.Element {
  return (
    <svg width="72" height="18" viewBox="0 0 72 18" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <rect
          key={i}
          x={i * 9}
          y={3}
          width={7}
          height={12}
          rx={1.5}
          fill="var(--accent)"
          opacity={spinning ? 0.25 : 0.4}
          style={
            spinning
              ? {
                  animation: `cell-pulse 1.3s ease-in-out ${i * 0.09}s infinite`,
                }
              : undefined
          }
        />
      ))}
      <style>
        {'@keyframes cell-pulse{0%,100%{opacity:.22}50%{opacity:.85}}'}
      </style>
    </svg>
  );
}

export function Skeleton({
  height = 16,
  width = '100%',
}: {
  readonly height?: number | string;
  readonly width?: number | string;
}): JSX.Element {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

/* ------------------------------------------------------------------ *
 * Notice banner
 * ------------------------------------------------------------------ */
export function Notice({
  tone = 'plain',
  children,
  icon,
}: {
  readonly tone?: 'plain' | 'honest' | 'good';
  readonly children: ReactNode;
  readonly icon?: ReactNode;
}): JSX.Element {
  const toneClass = tone === 'honest' ? 'notice-honest' : tone === 'good' ? 'notice-good' : '';
  return (
    <div className={`notice ${toneClass}`}>
      {icon ? (
        <span className="notice-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Segmented control
 * ------------------------------------------------------------------ */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  readonly options: readonly { value: T; label: string; hint?: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly label: string;
}): JSX.Element {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented-option"
          aria-pressed={value === option.value}
          title={option.hint}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Modal with a focus trap, Escape to close and a restored focus target.
 * ------------------------------------------------------------------ */
export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
    return () => openerRef.current?.focus?.();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <div className="spread" style={{ marginBottom: 'var(--s-4)' }}>
          <h2 id={titleId} style={{ fontSize: 'var(--fs-lg)' }}>
            {title}
          </h2>
          <Button variant="ghost" iconOnly onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </Button>
        </div>
        {children}
        {footer ? <div style={{ marginTop: 'var(--s-5)' }}>{footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Screen scaffold. Enforces the rule that every screen has a plain
 * title, a one-sentence purpose and a visible primary action.
 * ------------------------------------------------------------------ */
export function ScreenHeader({
  eyebrow,
  title,
  purpose,
  actions,
  children,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly purpose: string;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}): JSX.Element {
  return (
    <header className="screen-head">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1 className="screen-title">{title}</h1>
      <p className="screen-purpose">{purpose}</p>
      {actions ? (
        <div className="row-wrap" style={{ marginTop: 'var(--s-4)' }}>
          {actions}
        </div>
      ) : null}
      {children}
    </header>
  );
}

/** A labelled value row, used in dense technical panels. */
export function KeyValue({
  label,
  value,
  mono = true,
  help,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly mono?: boolean;
  readonly help?: string;
}): JSX.Element {
  return (
    <div
      className="spread"
      style={{
        gap: 'var(--s-4)',
        padding: 'var(--s-2) 0',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 'var(--fs-sm)',
      }}
    >
      <span className="muted row" style={{ gap: 'var(--s-1)' }}>
        {label}
        {help ? <InfoTip title={label} body={help} /> : null}
      </span>
      <span className={mono ? 'num' : ''} style={{ textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}

/** Number formatting used consistently everywhere a score is printed. */
export function formatScore(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'not available';
  return value.toFixed(digits);
}

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'not available';
  return groupInt(value);
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'not available';
  if (value < 1) return '<1 ms';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

/**
 * Scientific-notation formatting for the very small error values on the
 * verification screen, where 0.00 would be a lie by rounding.
 */
export function formatSci(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'not available';
  if (value === 0) return '0';
  if (Math.abs(value) < 1e-4 || Math.abs(value) >= 1e6) return value.toExponential(digits);
  return value.toFixed(digits + 2);
}
