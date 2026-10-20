import Link from "next/link";

export default function NoAccess() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">You don&apos;t have access to that page</h1>
        <p className="mt-2 text-sm text-muted">Ask the owner or an administrator if you think you should.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-brand hover:underline">Go to your home page</Link>
      </div>
    </div>
  );
}
