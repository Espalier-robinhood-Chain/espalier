import { guard, ok } from "@/lib/api/http";
import { listCordons } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export const GET = () => guard(async () => ok({ cordons: await listCordons() }));
