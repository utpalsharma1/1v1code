import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono, Martian_Mono } from "next/font/google";
import { MotionPrefProvider, motionPrefBootstrapScript } from "@1v1/ui";
import { Rail } from "./Rail";
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
          {/* The persistent left rail (§7). It hides itself on the match,
              spectate and challenge screens, where the viewport belongs to the
              match. Content is inset by the rail width on md and up. */}
          <Rail />
          <div className="md:pl-[68px]">{children}</div>
        </MotionPrefProvider>
      </body>
    </html>
  );
}
