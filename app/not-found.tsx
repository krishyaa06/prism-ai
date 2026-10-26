import Link from "next/link";

export default function NotFound() {
  return (
    <main className="notFound">
      <span className="brandMark big">◇</span>
      <p className="eyebrow">ERROR 404</p>
      <h1>This page drifted out of the prism.</h1>
      <p className="muted">The link may be broken or the page may have moved.</p>
      <div className="heroActions center">
        <Link href="/" className="primaryButton">Back home</Link>
        <Link href="/dashboard" className="secondaryButton">Open workspace</Link>
      </div>
    </main>
  );
}
