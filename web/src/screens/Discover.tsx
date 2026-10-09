/**
 * SCREEN A - Discover.
 *
 * The 30-second test governs this file: problem, what the tool does, and what
 * happens next must all be visible above the fold, in words a non-scientist
 * reads without stopping. Numbers come after that, never before.
 */

import { useState } from 'react';

import { Button, Card, Notice, ProvenanceBadge } from '../components/primitives';
import { HONESTY, HOW_IT_WORKS, JARGON, SITE } from '../content/copy';
import { VALID_SEQUENCES } from '../science/alphabet';
import { useStore } from '../state/store';
import { BindingConcept } from '../viz/BindingConcept';
import { MolecularScene } from '../viz/MolecularScene';
import { PlasticCards } from '../viz/PlasticCards';
import { useRouter } from '../app/router';
import { useReducedMotion } from '../app/hooks';
import type { Plastic } from '../science/potts';
import { groupInt } from '../content/format';

export function DiscoverScreen(): JSX.Element {
  const { state, dispatch } = useStore();
  const { navigate } = useRouter();
  const reducedMotion = useReducedMotion();
  const [surface, setSurface] = useState<Plastic>('PET');

  const perPosition = state.draftScore
    ? {
        PET: state.draftScore.contributions.PET.positions,
        PE: state.draftScore.contributions.PE.positions,
        PP: state.draftScore.contributions.PP.positions,
      }
    : null;

  return (
    <div className="screen">
      {/* ---------------- HERO ---------------- */}
      <section className="shell" data-tour="tour-hero">
        <div
          style={{
            display: 'grid',
            gap: 'var(--s-6)',
            gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 0.95fr)',
            alignItems: 'center',
          }}
          className="hero-grid"
        >
          <div>
            <p className="eyebrow">Computational peptide discovery</p>
            <h1
              style={{
                fontSize: 'var(--fs-hero)',
                marginBlock: 'var(--s-3)',
                letterSpacing: 'var(--tracking-tight)',
              }}
            >
              Can a tiny protein fragment{' '}
              <span style={{ color: 'var(--accent)' }}>tell plastics apart?</span>
            </h1>

            <p
              style={{
                fontSize: 'var(--fs-lg)',
                color: 'var(--text)',
                maxWidth: '54ch',
                lineHeight: 'var(--lh-snug)',
              }}
            >
              {SITE.promise}
            </p>

            <div
              className="stack-sm"
              style={{
                marginTop: 'var(--s-5)',
                paddingLeft: 'var(--s-4)',
                borderLeft: '2px solid var(--border-strong)',
              }}
            >
              <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                <strong style={{ color: 'var(--text-strong)' }}>The problem.</strong> Recycling
                works far better when plastics are separated. Telling them apart cheaply and
                reliably is still hard.
              </p>
              <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                <strong style={{ color: 'var(--text-strong)' }}>What this does.</strong> It
                searches every design in a reduced alphabet and scores each one against three
                plastics, so you can see which designs the model prefers for PET.
              </p>
              <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                <strong style={{ color: 'var(--text-strong)' }}>What is next.</strong> Build a
                design yourself and watch the scores move, then run the real search.
              </p>
            </div>

            <div className="row-wrap" style={{ marginTop: 'var(--s-6)' }}>
              <Button variant="primary" size="lg" onClick={() => navigate('build')}>
                Explore Discovery
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M3 8h10M9 4l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Button>
              <Button
                size="lg"
                onClick={() => {
                  dispatch({ type: 'TOUR_SEEN' });
                  navigate('optimise');
                }}
              >
                Run the search
              </Button>
              <Button variant="ghost" size="lg" onClick={() => navigate('understand')}>
                Understand the Science
              </Button>
            </div>

            <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-4)' }}>
              Free, anonymous, no sign-up. Everything runs in your browser.
            </p>
          </div>

          <Card raised style={{ padding: 'var(--s-4)' }}>
            <MolecularScene
              codes={state.draftCodes}
              tier={state.capability.tier}
              reducedMotion={reducedMotion}
              height={360}
            />
            <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
              <span className="badge badge-wrap">
                A {JARGON.peptide.term}: {JARGON.peptide.plain}
              </span>
              <ProvenanceBadge
                kind="illustrative"
                detail="A designed illustration of a peptide shape. Colours show the real building-block families of the sequence currently selected."
              />
            </div>
          </Card>
        </div>
      </section>

      {/* ---------------- 30-SECOND SUMMARY ---------------- */}
      <section className="shell" style={{ marginTop: 'var(--s-8)' }}>
        <Card
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--accent) 9%, var(--surface)), var(--surface))',
            borderColor: 'var(--border-strong)',
          }}
        >
          <div className="spread" style={{ alignItems: 'flex-start', gap: 'var(--s-5)' }}>
            <div style={{ maxWidth: '72ch' }}>
              <p className="eyebrow">The whole idea in 30 seconds</p>
              <p style={{ fontSize: 'var(--fs-md)', marginTop: 'var(--s-2)' }}>
                {SITE.thirtySeconds}
              </p>
            </div>
            <div className="stack-sm" style={{ flex: 'none', textAlign: 'right' }}>
              <div>
                <div
                  className="num"
                  style={{
                    fontSize: 'var(--fs-2xl)',
                    color: 'var(--accent)',
                    fontWeight: 700,
                    lineHeight: 1,
                  }}
                >
                  {groupInt(VALID_SEQUENCES)}
                </div>
                <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                  designs, all checked
                </div>
              </div>
              <div>
                <div
                  className="num"
                  style={{ fontSize: 'var(--fs-xl)', color: 'var(--optimise)', fontWeight: 700 }}
                >
                  48
                </div>
                <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                  on/off switches
                </div>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* ---------------- THE THREE PLASTICS ---------------- */}
      <section className="shell" style={{ marginTop: 'var(--s-8)' }} data-tour="tour-plastics">
        <h2 className="section-title">Three everyday plastics</h2>
        <p className="screen-purpose" style={{ marginBottom: 'var(--s-5)' }}>
          One we want the peptide to stick to, and two we want it to ignore. Select one to see
          how a design interacts with it.
        </p>
        <PlasticCards selected={surface} onSelect={setSurface} />
      </section>

      {/* ---------------- HOW IT WORKS ---------------- */}
      <section className="shell" style={{ marginTop: 'var(--s-8)' }}>
        <h2 className="section-title">How it works, in three steps</h2>
        <ol
          className="grid-auto"
          style={{ listStyle: 'none', padding: 0, marginTop: 'var(--s-5)' }}
        >
          {HOW_IT_WORKS.map((item) => (
            <li key={item.step}>
              <Card style={{ height: '100%' }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
                    border: '1px solid var(--accent)',
                    color: 'var(--accent)',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    marginBottom: 'var(--s-3)',
                  }}
                >
                  {item.step}
                </div>
                <h3 style={{ fontSize: 'var(--fs-md)' }}>{item.title}</h3>
                <p
                  className="muted"
                  style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-2)' }}
                >
                  {item.plain}
                </p>
                {state.mode === 'researcher' ? (
                  <p
                    className="faint mono"
                    style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}
                  >
                    {item.detail}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------- CONCEPTUAL BINDING ---------------- */}
      <section className="shell" style={{ marginTop: 'var(--s-8)' }} data-tour="tour-chain">
        <h2 className="section-title">What &ldquo;sticking&rdquo; means here</h2>
        <p className="screen-purpose" style={{ marginBottom: 'var(--s-5)' }}>
          A picture of the idea. Read the caption: this is a diagram, not a simulation.
        </p>
        <Card>
          <BindingConcept
            codes={state.draftCodes}
            perPosition={perPosition}
            surface={surface}
            reducedMotion={reducedMotion}
          />
          {!perPosition ? (
            <Notice>
              Interaction markers appear once a design has been scored. Open{' '}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => navigate('build')}
              >
                Build &amp; Explore
              </button>{' '}
              and the real per-position numbers will fill in here.
            </Notice>
          ) : null}
        </Card>
      </section>

      {/* ---------------- HONESTY ---------------- */}
      <section className="shell" style={{ marginTop: 'var(--s-8)' }} data-tour="tour-honesty">
        <h2 className="section-title">Before you read any number on this site</h2>
        <div className="grid-auto" style={{ marginTop: 'var(--s-4)' }}>
          <Notice tone="honest" icon="!">
            <strong>No laboratory work.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>{HONESTY.noLab}</p>
          </Notice>
          <Notice tone="honest" icon="!">
            <strong>{HONESTY.noQuantum}</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>{HONESTY.noQuantumDetail}</p>
          </Notice>
          <Notice tone="honest" icon="!">
            <strong>Not about breaking down plastic.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>{HONESTY.noDegradation}</p>
          </Notice>
          <Notice tone="honest" icon="!">
            <strong>A score, not a measurement.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>{HONESTY.noBinding}</p>
          </Notice>
        </div>
        <div className="row-wrap" style={{ marginTop: 'var(--s-5)' }}>
          <Button variant="primary" onClick={() => navigate('build')}>
            Start building a design
          </Button>
          <Button variant="ghost" onClick={() => navigate('understand')}>
            Read the full methodology
          </Button>
        </div>
      </section>

      <style>{`
        @media (max-width: 900px) {
          .hero-grid { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
