import Dashboard from "./ui";
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <Dashboard
      configured={
        !!(
          process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        )
      }
    />
  );
}
