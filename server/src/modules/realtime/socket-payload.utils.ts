import { inspect } from 'node:util';

export function logPayload(label: string, payload: unknown): void {
  console.log(`${label} incoming payload => ${inspect(payload, { depth: null, maxArrayLength: null, compact: false })}`);
}
