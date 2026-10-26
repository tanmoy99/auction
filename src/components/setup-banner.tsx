import { isConfigured } from "@/lib/supabase";

export function SetupBanner() {
  if (isConfigured) return null;
  return (
    <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
      Supabase is not connected yet. Copy <code className="font-mono">.env.example</code> to{" "}
      <code className="font-mono">.env.local</code>, add your keys and restart <code className="font-mono">npm run dev</code>.
    </div>
  );
}
