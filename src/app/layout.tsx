import type { Metadata } from "next";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Home CCTV", template: "%s · Home CCTV" },
  description: "Private local CCTV hub for a home Hikvision DVR.",
  applicationName: "Home CCTV",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh overflow-x-hidden bg-bg font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
