import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

/**
 * No public marketing page. This project is an internal tool, not a product site.
 * "/" is just an entry point: straight to the dashboard if you're signed in,
 * straight to the login form if you're not.
 */
export default async function Home() {
  const session = await getSession();
  redirect(session ? "/dashboard" : "/login");
}
