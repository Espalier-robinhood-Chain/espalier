import { guard, ok } from "@/lib/api/http";
import { listVaults } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export const GET = () => guard(async () => ok({ vaults: await listVaults() }));
