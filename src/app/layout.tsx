import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif, Unbounded } from "next/font/google";
import { Providers } from "@/components/providers";
import { Intro, INTRO_SCRIPT } from "@/components/intro";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});
const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin"], weight: ["300", "400", "500"] }); // headings and big numbers (font-serif), every look

export const metadata: Metadata = {
  title: "Almanac",
  description: "Never miss what matters. The calendar that won't let you forget.",
  appleWebApp: { capable: true, title: "Almanac", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Draw behind the status and gesture bars (no empty strips on phones); edge-touching parts pad by env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#141311" },
  ],
};

// Runs before paint so the page never flashes the wrong theme or look (Paper, Frost, Ember or Sky: see globals.css), each light or dark;
// Ember is coloured by its hue (--ember-hue). With no saved theme (System), light/dark follows the device live; with
// Day/Night ('auto'), the clock: light 6 am to 7 pm (the same hours as theme-toggle.tsx), checked each minute and on return.
const themeScript = `try{var d=document.documentElement,t=localStorage.theme,e=localStorage.look==='ember',h=new Date().getHours();if(t==='dark'||(t==='auto'&&(h<6||h>=19))||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))d.classList.add('dark');if(e)d.classList.add('ember');if(localStorage.look==='frost')d.classList.add('frost');if(localStorage.look==='sky')d.classList.add('sky');d.style.setProperty('--ember-hue',localStorage.emberHue||'44')}catch(x){}matchMedia('(prefers-color-scheme: dark)').addEventListener('change',function(m){try{if(!localStorage.theme)document.documentElement.classList.toggle('dark',m.matches)}catch(x){}});function dn(){try{if(localStorage.theme==='auto'){var h=new Date().getHours();document.documentElement.classList.toggle('dark',h<6||h>=19)}}catch(x){}}setInterval(dn,60000);document.addEventListener('visibilitychange',dn);`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} ${unbounded.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript + INTRO_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Intro />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
