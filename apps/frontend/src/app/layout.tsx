import type { Metadata } from "next";
import { Inter, Jost } from "next/font/google";
import Blob from "./components/blob";
import GazeProvider from "./components/gaze-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "gaze — Point with your eyes, direct with your voice",
  description:
    "Point with your eyes, direct with your voice. Describe your idea and we'll build the first version.",
};

const jost = Jost({
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jost.className} ${inter.variable}`}>
      <body className="bg-[#0a0a0a] text-white antialiased">
        {children}
        {/* Gaze blob: one liquid-glass cursor + global spacebar router for every page. */}
        <Blob />
        {/* Head-tracking sensor: publishes window.__gazePoint; silent without camera. */}
        <GazeProvider />
      </body>
    </html>
  );
}
