import { tome } from "./api.ts";

export type Payload = Record<string, unknown>;

export function parsePayload(text: string | undefined | null): Payload {
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`The payload attribute must be a JSON object, such as payload='{"wpm":20}'.`);
  }
  return parsed as Payload;
}

export async function declared(measured: Payload): Promise<Payload> {
  const subject = await tome.subject();
  const newest = subject.payloadSchemas.reduce((a, b) => (b.version > a.version ? b : a));
  const fields = newest.kinds.attempt?.properties ?? {};
  return Object.fromEntries(Object.entries(measured).filter(([name]) => name in fields));
}

export function dataOrNothing(data: Payload): { data?: Payload } {
  return Object.keys(data).length > 0 ? { data } : {};
}
