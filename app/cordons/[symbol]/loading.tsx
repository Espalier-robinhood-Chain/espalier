import { Footer, Header } from "@/components/layout-parts";
import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <>
      <Header />
      <main aria-busy="true" className="mx-auto max-w-5xl space-y-6 px-4 py-12">
        <p role="status" className="sr-only">Loading Cordon</p>
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-5 w-full max-w-prose" />
        <div className="grid gap-4 md:grid-cols-[1fr_20rem]"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      </main>
      <Footer />
    </>
  );
}
