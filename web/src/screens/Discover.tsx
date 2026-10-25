/**
 * SCREEN 1 - Discover.
 *
 * Above the fold: the problem, what the tool does, and the way in. One column,
 * measured for reading rather than stretched across the viewport.
 *
 * There is deliberately no molecule here. The 2D/3D viewer lives on Build &
 * Explore, where the residues it draws can actually be changed; a second copy
 * on the landing page showed the same picture with no way to affect it.
 *
 * The detailed scientific-validity assessment is NOT on this screen either. It
 * lives once, at the bottom of Results.
 */

import { useState } from 'react';

import { useRouter } from '../app/router';
import { Beginner, Equation, Researcher } from '../app/mode';
import { Button, Card } from '../components/primitives';
import { HOW_IT_WORKS, SCREENS, SITE } from '../content/copy';
import { groupInt } from '../content/format';
import { CLASS_INFO, VALID_SEQUENCES } from '../science/alphabet';
import type { Plastic } from '../science/potts';
import { useStore } from '../state/store';
import { PlasticCards } from '../viz/PlasticCards';

export function DiscoverScreen(): JSX.Element {
  const { state } = useStore();
  const { navigate } = useRouter();
  const [surface, setSurface] = useState<Plastic>('PET');

  return (
    <div className="screen">
      {/* ---------------- HERO ---------------- */}
      <section className="shell hero" data-tour="tour-hero">
        <div className="hero-copy">
          <p className="eyebrow">Computational peptide design</p>
          <h1 className="hero-title">
            Can an eight-residue peptide tell{' '}
            <span style={{ color: 'var(--accent)' }}>one plastic from another?</span>
          </h1>

          <p className="hero-lede">{SITE.promise}</p>

          <dl className="hero-facts">
            <div>
              <dt>The problem</dt>
              <dd>
                Recycling works far better when plastics are separated, and telling them apart
                cheaply is still hard.
              </dd>
            </div>
            <div>
              <dt>What this does</dt>
              <dd>
                Scores every design in a reduced six-family alphabet against three plastics and
                finds the ones the model prefers for PET.
              </dd>
            </div>
            <div>
              <dt>What you can do here</dt>
              <dd>
                Build a design, watch the real scores move, then run the exhaustive search in
                your own browser.
              </dd>
            </div>
          </dl>

          <div className="hero-actions">
            <Button variant="primary" size="lg" onClick={() => navigate('build')}>
              Open the design workbench
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
            <Button size="lg" onClick={() => navigate('optimise')}>
              Run the exhaustive search
            </Button>
          </div>

          <p className="hero-meta">
            Runs entirely in your browser &mdash; no account, no tracking, nothing uploaded.{' '}
            <button type="button" className="link-button" onClick={() => navigate('understand')}>
              Read the method
            </button>
            .
          </p>
        </div>
      </section>

      {/* ---------------- NUMBERS THAT MATTER ---------------- */}
      <section className="shell section">
        <div className="figure-row">
          <div className="figure-item">
            <span className="figure-value">{groupInt(VALID_SEQUENCES)}</span>
            <span className="figure-label">designs, every one scored</span>
          </div>
          <div className="figure-item">
            <span className="figure-value">48</span>
            <span className="figure-label">binary variables in the QUBO form</span>
          </div>
          <div className="figure-item">
            <span className="figure-value">36</span>
            <span className="figure-label">model terms per score (8 single + 28 pair)</span>
          </div>
        </div>
        <p className="section-lede" style={{ marginTop: 'var(--s-5)' }}>
          {SITE.thirtySeconds}
        </p>
      </section>

      {/* ---------------- WHO YOU ARE ----------------
          The one place the two modes are introduced, so the switch in the
          header is not a mystery control. */}
      <section className="shell section">
        <Beginner>
          <div className="primer">
            <h2 className="section-title">Three words you will meet</h2>
            <dl className="primer-list">
              <div>
                <dt>Peptide</dt>
                <dd>
                  A short chain of amino acids &mdash; the same building blocks proteins are made
                  of, just a few of them instead of hundreds. Every design here is eight long.
                </dd>
              </div>
              <div>
                <dt>PET, PE, PP</dt>
                <dd>
                  Three common plastics. PET is drink bottles, PE is bags and film, PP is tubs and
                  bottle caps. They look similar to a sorting machine, which is part of why
                  recycling is hard.
                </dd>
              </div>
              <div>
                <dt>Selectivity</dt>
                <dd>
                  Sticking to one thing and ignoring the others. A peptide that sticks to all
                  three plastics equally is useless for sorting them; the gap between the scores
                  is what matters.
                </dd>
              </div>
            </dl>
            <p className="primer-foot">
              You are reading <strong>Beginner</strong> mode. Switch to <strong>Researcher</strong>{' '}
              in the header for the equations, the raw coefficients and the full methodology.
            </p>
          </div>
        </Beginner>

        <Researcher>
          <div className="primer">
            <h2 className="section-title">Problem statement</h2>
            <p className="section-lede">
              Minimise a selectivity objective over the full class space of an eight-position
              peptide drawn from a six-class reduced amino-acid alphabet, where the per-plastic
              scores come from a six-class Potts model aggregated from the published
              QA-PBP-RL-Nexus energies (backbone bb1, arithmetic-mean 20&rarr;6 aggregation).
            </p>
            <Equation label="Lambda is a chosen weight, not a measured quantity. Scores are negated Potts energies: higher means stronger predicted binding.">
{`minimise  f(c) = -PET(c) + lambda * ( PE(c) + PP(c) )
over      c in {0,...,5}^8          |space| = 6^8 = 1,679,616

score_p(c) = intercept + sum_i h_p[i, c_i] + sum_{i<j} J_p[i, j, c_i, c_j]
             for p in {PET, PE, PP}`}
            </Equation>
            <p className="primer-foot">
              You are reading <strong>Researcher</strong> mode: equations, seeds, full-precision
              values and every table column are shown. Switch to <strong>Beginner</strong> in the
              header for the guided version.
            </p>
          </div>
        </Researcher>
      </section>

      {/* ---------------- THE THREE PLASTICS ---------------- */}
      <section className="shell section" data-tour="tour-plastics">
        <header className="section-head">
          <h2 className="section-title">One target, two things to avoid</h2>
          <p className="section-lede">
            The model scores every design against all three. A useful design scores high for the
            first and low for the other two.
          </p>
        </header>
        <PlasticCards selected={surface} onSelect={setSurface} />
      </section>

      {/* ---------------- THE SIX FAMILIES ---------------- */}
      <section className="shell section" data-tour="tour-chain">
        <header className="section-head">
          <h2 className="section-title">The six building-block families</h2>
          <p className="section-lede">
            Twenty natural amino acids are grouped into six families by the chemistry that
            matters for sticking to a surface. The search works at family resolution, which is
            what makes an exhaustive search of {groupInt(VALID_SEQUENCES)} designs possible.
          </p>
        </header>
        <div className="family-grid">
          {CLASS_INFO.map((info) => (
            <article key={info.id} className="family-card">
              <header>
                <span
                  className="family-swatch"
                  style={{ background: `var(${info.token})` }}
                  aria-hidden="true"
                />
                <h3>{info.name}</h3>
              </header>
              <p className="family-residues">
                {info.residues.join(' · ')}
                <span className="family-count">
                  {info.residues.length === 1
                    ? '1 amino acid'
                    : `${info.residues.length} amino acids`}
                </span>
              </p>
              <p className="family-property">{info.property}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------------- HOW IT WORKS ---------------- */}
      <section className="shell section">
        <header className="section-head">
          <h2 className="section-title">How the search works</h2>
        </header>
        <ol className="step-list">
          {HOW_IT_WORKS.map((item) => (
            <li key={item.step}>
              <span className="step-index" aria-hidden="true">
                {item.step}
              </span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.plain}</p>
                {state.mode === 'researcher' ? (
                  <p className="step-detail mono">{item.detail}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------- NEXT ---------------- */}
      <section className="shell section">
        <Card>
          <div className="spread" style={{ gap: 'var(--s-5)', flexWrap: 'wrap' }}>
            <div style={{ maxWidth: '58ch' }}>
              <h2 style={{ fontSize: 'var(--fs-lg)' }}>Start with the workbench</h2>
              <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-2)' }}>
                {SCREENS.build.purpose} Every edit is re-scored exactly, and the molecular
                structure is rebuilt from the residues you choose.
              </p>
            </div>
            <div className="row-wrap">
              <Button variant="primary" onClick={() => navigate('build')}>
                Build a design
              </Button>
              <Button variant="ghost" onClick={() => navigate('results')}>
                See the reference result
              </Button>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
