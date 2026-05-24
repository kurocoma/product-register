import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SideNav } from "@/components/nav/SideNav";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <SideNav />
      <main className="flex-1 bg-slate-50">{children}</main>
    </div>
  );
}
