import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono, Martian_Mono } from "next/font/google";
import { MotionPrefProvider, motionPrefBootstrapScript } from "@1v1/ui";
import { Nav } from "./Nav";
import "./globals.css";

// Display / headings / HUD. Monospace headlines are the point, not an accident.
const martian = Martian_Mono({
  subsets: ["latin"],
  variable: "--font-martian",
  display: "swap",
});

// Body / UI.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

// Code and every numeral in the product.
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "1v1.code",
  description: "A real-time competitive programming arena.",
};

export const viewport: Viewport = {
  themeColor: "#080B12",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${martian.variable} ${geist.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Resolves the motion preference before first paint so ambient CSS
            animations never start and then get yanked. */}
        <script dangerouslySetInnerHTML={{ __html: motionPrefBootstrapScript }} />
      </head>
      <body className="bg-ink text-fg min-h-dvh">
        <MotionPrefProvider>
          {/* Persistent and deliberately thin. §6.4 wants the match HUD fixed
              to the top and never scrolling away; a 45px bar above it costs
              little and means there is always a way out of a screen. */}
          <Nav />
          {children}
        </MotionPrefProvider>
      </body>
    </html>
  );
}
