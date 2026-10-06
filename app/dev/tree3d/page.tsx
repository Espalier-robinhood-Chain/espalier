// Halaman pemeriksaan untuk scripts/e2e-tree3d.mjs. Seperti /dev/components: hapus sebelum rilis.
// /dev/tree3d?n=12&h=14&s=5 menggambar n posisi (bobot menurun), h Harvest, streak s.
import { notFound } from "next/navigation";
import { GardenTree } from "@/components/garden-tree";

export const metadata = { robots: { index: false } };
const int = (v: string | string[] | undefined, d: number, max: number) => {
  const x = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(x) && x >= 0 ? Math.min(x, max) : d;
};

export default async function Tree3DCheck({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_PAGES !== "1") notFound();
  const q = await searchParams;
  const n = int(q.n, 3, 40);
  const positions = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, weightBps: Math.max(100, 6000 - i * 250) }));
  return (
    <main className="wrap py-10">
      <GardenTree input={{ address: "0x0000000000000000000000000000000000000003", totalValueUsd: 1_000_000, harvests: int(q.h, 14, 200), streak: int(q.s, 5, 60), positions }} className="w-full max-w-[560px]" />
    </main>
  );
}
