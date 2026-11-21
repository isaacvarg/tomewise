import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(time: number): string {
  let timePart = "";
  for (let rest = time, i = 0; i < 10; i++, rest = Math.floor(rest / 32)) {
    timePart = CROCKFORD[rest % 32] + timePart;
  }
  const randomPart = [...randomBytes(16)].map((byte) => CROCKFORD[byte % 32]).join("");
  return timePart + randomPart;
}
