import { Suspense } from "react";
import { PageLoader } from "@/components/ui";

// Suspense boundary: the page reads the URL with useParams(), which is only known at request time
export default function Layout({ children }: LayoutProps<"/bid/[id]">) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}
