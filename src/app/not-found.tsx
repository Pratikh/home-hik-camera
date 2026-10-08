import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-ink">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link href="/" className="mt-4 text-sm text-teal">
        Back to dashboard
      </Link>
    </main>
  );
}
