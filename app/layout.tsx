import type { Metadata, Viewport } from "next";
import { DM_Mono, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ variable: "--font-sans", subsets: ["latin"], display: "swap" });
const dmMono = DM_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

const url = "https://prism-ai-umber.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(url),
  title: {
    default: "Prism AI · Build. Explore. Create.",
    template: "%s · Prism AI",
  },
  description:
    "Prism AI is a developer-first workspace for documents, ideas and AI-assisted thinking. Built by Prism Protocol.",
  keywords: ["Prism AI", "AI workspace", "notes", "AI assistant", "Next.js", "Prism Protocol"],
  authors: [{ name: "Soumya Bhandare", url: "https://github.com/krishyaa06" }],
  openGraph: {
    title: "Prism AI · Build. Explore. Create.",
    description: "A developer-first workspace for documents, ideas and AI-assisted thinking.",
    url,
    siteName: "Prism AI",
    type: "website",
  },
  twitter: { card: "summary_large_image", creator: "@krishyaa06" },
};

export const viewport: Viewport = {
  themeColor: "#070912",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} ${dmMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
