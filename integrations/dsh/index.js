import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';
import { mountDshBridge } from './bridge.js';

export const name = 'crosschat-dsh-bridge';
export const inject = ['agents'];

export async function apply(ctx, config = {}) {
  await mountDshBridge(ctx, { createUserMessage, getDshRuntimeVersion }, config);
}
