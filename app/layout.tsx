import type { Metadata } from "next";
import { DM_Mono, Manrope } from "next/font/google";
import { AnalyticsConsent } from "./analytics-consent";
import "./globals.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const dmMono = DM_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://mesh-medic.com"),
  title: {
    default: "Free Online STL Repair Tool | MeshMedic",
    template: "%s | MeshMedic",
  },
  description: "Find and highlight STL mesh faults, understand what’s wrong, choose safe repairs and compare the result before downloading. Free and private in your browser.",
  keywords: [
    "STL repair",
    "repair STL online",
    "STL fixer",
    "fix non manifold STL",
    "3D printing file repair",
    "mesh repair",
    "watertight STL",
    "STL error checker",
  ],
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    url: "https://mesh-medic.com",
    siteName: "MeshMedic",
    title: "Free Online STL Repair Tool | MeshMedic",
    description: "See what’s broken, choose safe STL repairs and compare the result before downloading. Free, transparent and private in your browser.",
    locale: "en_GB",
  },
  twitter: {
    card: "summary",
    title: "Free Online STL Repair Tool | MeshMedic",
    description: "See what’s broken, choose safe STL repairs and verify the result privately in your browser.",
  },
  category: "technology",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon-32.png",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": "https://mesh-medic.com/#app",
        name: "MeshMedic",
        url: "https://mesh-medic.com",
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any modern web browser",
        browserRequirements: "Requires JavaScript and WebGL",
        description: "A transparent browser-based STL repair tool that highlights mesh faults, explains them, gives users control over repairs and supports before-and-after verification.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
        featureList: [
          "Open-edge detection",
          "Non-manifold edge detection",
          "Degenerate and duplicate face cleanup",
          "Coincident vertex welding",
          "Surface normal recalculation",
          "Conservative planar hole filling",
          "Binary STL export",
        ],
        creator: {
          "@type": "Organization",
          name: "Grey Patrick",
          url: "https://greypatrick.com",
        },
      },
      {
        "@type": "FAQPage",
        "@id": "https://mesh-medic.com/#faq",
        mainEntity: [
          {
            "@type": "Question",
            name: "How do I repair an STL file online?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Drop an STL into MeshMedic, review the mesh diagnostics, select the repair operations you want, compare the original and repaired models, then download the repaired STL.",
            },
          },
          {
            "@type": "Question",
            name: "Does MeshMedic upload or store my STL file?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "No. MeshMedic processes the STL locally in your browser, so the model is not uploaded to a MeshMedic server.",
            },
          },
          {
            "@type": "Question",
            name: "What STL problems can MeshMedic detect?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "MeshMedic detects open edges, non-manifold edges, degenerate faces, duplicate faces and disconnected shells.",
            },
          },
        ],
      },
    ],
  };

  return (
    <html lang="en">
      <body className={`${manrope.variable} ${dmMono.variable}`}>
        {children}
        <AnalyticsConsent measurementId={process.env.GA_MEASUREMENT_ID ?? ""} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      </body>
    </html>
  );
}
