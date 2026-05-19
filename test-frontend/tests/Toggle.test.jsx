// T-211 (CODE-AUDIT D.9 #2 follow-up): Toggle component test.
//
// Toggle is at src/primitives.jsx:145. It's the toggle-switch primitive used
// in Settings screens (notification channels, display preferences) and the
// Brokers screen. Contract:
//   - renders a <button> with class "toggle" base.
//   - adds class "toggle--on" when on=true.
//   - sets aria-pressed="true" / "false" based on `on` prop.
//   - calls onClick when clicked.
//
// We test without @testing-library/react -- ReactDOM.render into a jsdom
// container is sufficient for this primitive. Adding @testing-library/react
// would double the devDependency surface; defer until the first multi-
// component test that actually needs its helpers.

import { describe, it, expect } from 'vitest';
import React from 'react';
import ReactDOM from 'react-dom';
import { loadJsx } from '../lib/load-jsx.js';

const prims = loadJsx('src/primitives.jsx');
const Toggle = prims.Toggle;

function renderInto(container, element) {
  // React 18 still ships .render under ReactDOM for legacy paths. This
  // suppresses the dev warning in setup.js.
  ReactDOM.render(element, container);
}

describe('Toggle (src/primitives.jsx)', () => {
  it('is exposed as a function/component on window', () => {
    expect(typeof Toggle).toBe('function');
  });

  it('renders a button element', () => {
    const div = document.createElement('div');
    renderInto(div, React.createElement(Toggle, { on: false, onClick: () => {} }));
    const btn = div.querySelector('button');
    expect(btn).not.toBeNull();
  });

  it('adds toggle--on class when on=true', () => {
    const div = document.createElement('div');
    renderInto(div, React.createElement(Toggle, { on: true, onClick: () => {} }));
    const btn = div.querySelector('button');
    expect(btn.className).toContain('toggle--on');
  });

  it('omits toggle--on class when on=false', () => {
    const div = document.createElement('div');
    renderInto(div, React.createElement(Toggle, { on: false, onClick: () => {} }));
    const btn = div.querySelector('button');
    expect(btn.className).not.toContain('toggle--on');
    expect(btn.className).toContain('toggle');
  });

  it('sets aria-pressed="true" when on=true', () => {
    const div = document.createElement('div');
    renderInto(div, React.createElement(Toggle, { on: true, onClick: () => {} }));
    const btn = div.querySelector('button');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('sets aria-pressed="false" when on=false', () => {
    const div = document.createElement('div');
    renderInto(div, React.createElement(Toggle, { on: false, onClick: () => {} }));
    const btn = div.querySelector('button');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onClick handler when clicked', () => {
    const div = document.createElement('div');
    let clickCount = 0;
    renderInto(div, React.createElement(Toggle, { on: false, onClick: () => { clickCount++; } }));
    const btn = div.querySelector('button');
    btn.click();
    expect(clickCount).toBe(1);
  });
});
