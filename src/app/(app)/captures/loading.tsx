import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";

export default function CapturesLoading() {
  return (
    <>
      <PageHeader title="Capture Inbox" description="Loading saved captures…" />
      <div role="status" aria-label="Loading captures" className="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-10 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
        <Card className="h-40 animate-pulse bg-paper" />
        <Card className="h-80 animate-pulse bg-paper" />
      </div>
    </>
  );
}
