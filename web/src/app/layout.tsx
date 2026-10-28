import type { Metadata } from "next";
import "./style.css";

export const metadata: Metadata = {
  title: "Prism AI • Digital Worker",
  description: "Self-hosted AI agent console for your own Prism model.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
