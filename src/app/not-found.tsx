import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-ink">
      <div className="card card--pad" style={{ maxWidth: 420, textAlign: "center" }}>
        <div className="page-head__eyebrow" style={{ justifyContent: "center" }}>Not found</div>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted">This route does not exist on the hub.</p>
        <Link href="/" className="btn btn--primary mt-5">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
