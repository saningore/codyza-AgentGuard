import type { Metadata, Viewport } from "next";
import { Fraunces, Outfit } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const sans = Outfit({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-outfit" });
const serif = Fraunces({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-fraunces" });

export const metadata: Metadata = {
  title: { default: "AgentGuard", template: "%s · AgentGuard" },
  description: "Permission, approval, and monitoring for organization AI agents.",
  applicationName: "AgentGuard",
};

export const viewport: Viewport = { themeColor: "#1c1915", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <a className="skip-link" href="#main">Skip to content</a>
        <div className="min-h-screen">{children}</div>
        <footer className="border-t border-line px-4 py-8 text-center text-sm">
          <p className="font-bold">
            <Link className="underline underline-offset-2" href="https://codyza.com" target="_blank" rel="noopener noreferrer">
              Powered by Codyza
            </Link>
          </p>
          <p className="mt-2 text-ink/70">AgentGuard records every agent decision before a side effect is saved.</p>
        </footer>
      </body>
    </html>
  );
}
