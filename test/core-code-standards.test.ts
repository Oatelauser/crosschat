import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('progressive typed lint rules', () => {
  const lint = new ESLint();
  const filePath = 'src/application/sessions/catalog.ts';

  it('rejects floating promises, async void callbacks and value imports used only as types', async () => {
    const [result] = await lint.lintText([
      "import { Session } from './model.js';",
      'async function work(): Promise<void> {}',
      'export function sample(value: Session): void {',
      '  work();',
      '  [value].forEach(async () => { await work(); });',
      '}',
    ].join('\n'), { filePath });
    expect(result.messages.map((message) => message.ruleId)).toEqual(expect.arrayContaining([
      '@typescript-eslint/no-floating-promises',
      '@typescript-eslint/no-misused-promises',
      '@typescript-eslint/consistent-type-imports',
    ]));
  });

  it('accepts type-only imports and deliberately handled asynchronous work', async () => {
    const [result] = await lint.lintText([
      "import type { Session } from './model.js';",
      'async function work(): Promise<void> {}',
      'export async function sample(value: Session): Promise<Session> {',
      '  await work();',
      '  return value;',
      '}',
    ].join('\n'), { filePath });
    expect(result.messages).toEqual([]);
  });
});
