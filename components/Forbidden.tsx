import Link from "next/link";

/** Rendered when the current staff identity lacks the permission a page needs. */
export default function Forbidden({ permission }: { permission: string }) {
  return (
    <div className="forbidden">
      <div className="lock">🔒</div>
      <h2>Not authorized</h2>
      <p className="muted">
        Your role doesn&rsquo;t have the <span className="mono">{permission}</span> permission.
      </p>
      <Link className="btn btn-ghost" href="/admin" style={{ marginTop: 12 }}>Back to admin</Link>
    </div>
  );
}
