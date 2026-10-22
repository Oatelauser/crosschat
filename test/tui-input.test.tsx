import { useEffect } from 'react';
import { Text, useInput, usePaste } from 'ink';
import type { Key } from 'ink';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTuiController } from '../src/tui/app/controller.js';
import type { TuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry } from '../src/tui/resources/registry.js';
import { inputKeys } from '../src/tui/ui/input.js';

function key(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, pageDown: false, pageUp: false,
    home: false, end: false, return: false, escape: false, ctrl: false, shift: false, tab: false,
    backspace: false, delete: false, meta: false, super: false, hyper: false, capsLock: false, numLock: false,
    ...overrides,
  };
}

function InputHarness({ controller, ready }: { controller: TuiController; ready(): void }) {
  useInput((input, pressed) => {
    for (const event of inputKeys(input, pressed)) controller.handleKey(event);
  });
  usePaste((text) => controller.handleKey({ name: 'paste', text }));
  useEffect(ready, [ready]);
  return <Text>isolated input fixture</Text>;
}

afterEach(cleanup);

describe('Ink input batches', () => {
  it('splits ordinary text into ordered complete graphemes', () => {
    expect(inputKeys(':e\u0301👩🏽‍💻', key()).map((event) => ({ name: event.name, text: event.text })))
      .toEqual([{ name: ':', text: ':' }, { name: 'e\u0301', text: 'e\u0301' }, { name: '👩🏽‍💻', text: '👩🏽‍💻' }]);
  });

  it.each([
    ['upArrow', 'up'], ['downArrow', 'down'], ['leftArrow', 'left'], ['rightArrow', 'right'],
    ['pageUp', 'pageup'], ['pageDown', 'pagedown'], ['home', 'home'], ['end', 'end'],
    ['return', 'enter'], ['escape', 'escape'], ['tab', 'tab'], ['backspace', 'backspace'], ['delete', 'delete'],
  ] as const)('dispatches %s once as %s without inserting terminal sequences', (flag, expected) => {
    const events = inputKeys('', key({ [flag]: true, shift: true }));
    expect(events).toEqual([{ name: expected, ctrl: false, shift: true, alt: false }]);
  });

  it('keeps modifier chords as one event', () => {
    expect(inputKeys('c', key({ ctrl: true }))).toEqual([{ name: 'c', text: 'c', ctrl: true, shift: false, alt: false }]);
    expect(inputKeys('ab', key({ meta: true }))).toHaveLength(1);
  });

  it('ignores empty input and key release notifications', () => {
    expect(inputKeys('', key())).toEqual([]);
    expect(inputKeys(':s', key({ eventType: 'release' }))).toEqual([]);
  });

  it('recognizes control keys inside a combined ordinary input batch', () => {
    const events = inputKeys('\r\n\n\t\b\u007f\u0003', key());
    expect(events.map((event) => event.name)).toEqual(['enter', 'enter', 'tab', 'backspace', 'backspace', 'c']);
    expect(events.at(-1)?.ctrl).toBe(true);
    expect(events.slice(0, -1).every((event) => !event.ctrl)).toBe(true);
    expect(inputKeys('ignored\r', key({ delete: true }))).toEqual([{ name: 'delete', ctrl: false, shift: false, alt: false }]);
  });

  it('feeds one real useInput batch across the list and command editor modes', async () => {
    const controller = createTuiController({ registry: createResourceRegistry(), contexts: [{ id: 'fixture', kind: 'local', label: 'fixture' }], adapters: {} });
    const ready = vi.fn();
    const app = render(<InputHarness controller={controller} ready={ready} />);
    try {
      await vi.waitFor(() => expect(ready).toHaveBeenCalled());
      app.stdin.write(':s');
      await vi.waitFor(() => expect(controller.getSnapshot().input?.editor.text).toBe('s'));
      expect(controller.getSnapshot().mode).toBe('input');
      app.stdin.write('essions');
      await vi.waitFor(() => expect(controller.getSnapshot().input?.editor.text).toBe('sessions'));
      app.stdin.write('\r');
      await vi.waitFor(() => expect(controller.getSnapshot().route.resourceId).toBe('sessions'));
    } finally { controller.dispose(); app.unmount(); }
  });

  it('keeps bracketed paste separate from batched shortcut dispatch', async () => {
    const exit = vi.fn();
    const controller = createTuiController({ registry: createResourceRegistry(), contexts: [], adapters: {}, onExit: exit });
    const ready = vi.fn();
    const app = render(<InputHarness controller={controller} ready={ready} />);
    try {
      await vi.waitFor(() => expect(ready).toHaveBeenCalled());
      app.stdin.write('\u001b[200~:q\u001b[201~');
      expect(controller.getSnapshot().mode).toBe('list');
      expect(exit).not.toHaveBeenCalled();
      app.stdin.write('/');
      await vi.waitFor(() => expect(controller.getSnapshot().mode).toBe('input'));
      app.stdin.write('\u001b[200~中👩🏽‍💻e\u0301q\u001b[201~');
      await vi.waitFor(() => expect(controller.getSnapshot().input?.editor).toEqual({ text: '中👩🏽‍💻e\u0301q', cursor: 4 }));
      expect(exit).not.toHaveBeenCalled();
    } finally { controller.dispose(); app.unmount(); }
  });

  it('handles movement and Enter combined in one real useInput batch', async () => {
    const controller = createTuiController({ registry: createResourceRegistry(), contexts: [
      { id: 'local', kind: 'local', label: 'first' }, { id: 'ssh:fixture', kind: 'ssh', label: 'second' },
    ], adapters: {} });
    const ready = vi.fn();
    const app = render(<InputHarness controller={controller} ready={ready} />);
    try {
      await vi.waitFor(() => expect(ready).toHaveBeenCalled());
      app.stdin.write('j\r');
      await vi.waitFor(() => expect(controller.getSnapshot().route).toEqual({ resourceId: 'sessions', contextId: 'ssh:fixture' }));
    } finally { controller.dispose(); app.unmount(); }
  });

  it('handles command text and Enter combined in one real useInput batch', async () => {
    const controller = createTuiController({ registry: createResourceRegistry(), contexts: [], adapters: {} });
    const ready = vi.fn();
    const app = render(<InputHarness controller={controller} ready={ready} />);
    try {
      await vi.waitFor(() => expect(ready).toHaveBeenCalled());
      app.stdin.write(':sessions\r');
      await vi.waitFor(() => expect(controller.getSnapshot().route.resourceId).toBe('sessions'));
      expect(controller.getSnapshot().mode).toBe('list');
    } finally { controller.dispose(); app.unmount(); }
  });
});
