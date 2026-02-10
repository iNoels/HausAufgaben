import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HausAufgaben",
  description: "WebApp zur anzeige von aktuellen Aufgaben rund ums Grundstück",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
