import { Footer, Header } from "@/components/layout-parts";
import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <>
      <Header />
      <main aria-busy="true" className="mx-auto max-w-5xl space-y-6 px-4 py-12">
        <p role="status" className="sr-only">Loading the current round</p>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-5 w-full max-w-prose" />
        <Skeleton className="h-52" />
      </main>
      <Footer />
    </>
  );
}
