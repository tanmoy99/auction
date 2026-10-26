import { Suspense } from "react";
import { PageLoader } from "@/components/ui";
import { TournamentShell } from "./shell";

// Suspense boundary: the shell reads the URL with useParams(), which is only known at request time
export default function Layout({ children }: LayoutProps<"/t/[id]">) {
  return (
    <Suspense fallback={<PageLoader />}>
      <TournamentShell>{children}</TournamentShell>
    </Suspense>
  );
}
