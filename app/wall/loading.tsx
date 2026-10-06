import { Footer, Header } from "@/components/layout-parts";
import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <>
      <Header />
      <main aria-busy="true" className="mx-auto max-w-5xl space-y-6 px-4 py-12">
        <p role="status" className="sr-only">Loading garden</p>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-11 w-full max-w-md" />
        <div className="grid gap-6 md:grid-cols-[20rem_1fr]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
      </main>
      <Footer />
    </>
  );
}
