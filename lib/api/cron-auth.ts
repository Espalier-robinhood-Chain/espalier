// Server saja. Route cron hanya boleh dipanggil dengan header `Authorization: Bearer <CRON_SECRET>`.
import { timingSafeEqual } from "node:crypto";

export function authorized(header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
