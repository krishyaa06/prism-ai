import type { Metadata } from "next";
import "./style.css";
import "./brand-theme.css";

export const metadata: Metadata = {
  title: "Prism • Personal Digital Worker",
  description: "A private, user-controlled AI workspace for your phone.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
