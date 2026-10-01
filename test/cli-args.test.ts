import { describe, expect, it } from 'vitest';
import { parseSendArgs, parseStatusArgs } from '../src/cli.js';
import { MultichatError } from '../src/errors.js';

function expectUsage(fn: () => unknown, needle: string): void {
  try {
    fn();
    expect.unreachable('should have thrown USAGE');
  } catch (err) {
    expect(err).toBeInstanceOf(MultichatError);
    const me = err as MultichatError;
    expect(me.code).toBe('USAGE');
    expect(me.message).toContain(needle);
  }
}

describe('parseSendArgs', () => {
  it('parses space-separated values', () => {
    expect(parseSendArgs(['--to', 'alpha', '--body', 'hello there'])).toEqual({
      to: 'alpha',
      bodyArg: 'hello there',
    });
  });

  it('parses --opt=value forms', () => {
    expect(parseSendArgs(['--to=alpha', '--body=hi', '--conversation=mc1_x'])).toEqual({
      to: 'alpha',
      bodyArg: 'hi',
      conversation: 'mc1_x',
    });
  });

  it('parses --json as a flag', () => {
    expect(parseSendArgs(['--json'])).toEqual({ json: true });
    expect(parseSendArgs(['--to', 'a', '--json'])).toEqual({ to: 'a', json: true });
  });

  it('keeps the last value when an option repeats', () => {
    expect(parseSendArgs(['--to', 'a', '--to', 'b'])).toEqual({ to: 'b' });
  });

  it('accepts an empty --body value (runtime rejects it as BODY_REQUIRED)', () => {
    expect(parseSendArgs(['--to', 'a', '--body='])).toEqual({ to: 'a', bodyArg: '' });
  });

  it('rejects unknown options, missing values, and positionals', () => {
    expectUsage(() => parseSendArgs(['--wat']), 'unknown option');
    expectUsage(() => parseSendArgs(['--to']), 'requires a value');
    expectUsage(() => parseSendArgs(['alpha']), 'unexpected argument');
    expectUsage(() => parseSendArgs(['--json=true']), 'takes no value');
    expectUsage(() => parseSendArgs(['--conversation']), 'requires a value');
  });
});

describe('parseStatusArgs', () => {
  it('accepts nothing or --json', () => {
    expect(parseStatusArgs([])).toEqual({ json: false });
    expect(parseStatusArgs(['--json'])).toEqual({ json: true });
  });

  it('rejects anything else', () => {
    expectUsage(() => parseStatusArgs(['--to', 'x']), 'only --json');
    expectUsage(() => parseStatusArgs(['--json', '--json']), 'only --json');
  });
});
