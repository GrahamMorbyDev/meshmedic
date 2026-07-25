import type { Metadata } from "next";
import { DM_Mono, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const dmMono = DM_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://mesh-medic.com"),
  title: {
    default: "Free Online STL Repair Tool | MeshMedic",
    template: "%s | MeshMedic",
  },
  description: "Repair STL files online for free. Find open edges, non-manifold geometry and broken faces, then download a cleaner, slicer-ready STL. Private browser processing.",
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
    description: "Inspect and repair common STL mesh problems locally in your browser. No upload queue and no model storage.",
    locale: "en_GB",
  },
  twitter: {
    card: "summary",
    title: "Free Online STL Repair Tool | MeshMedic",
    description: "Inspect and repair common STL mesh problems privately in your browser.",
  },
  category: "technology",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
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
        description: "A private browser-based STL diagnostics and mesh repair tool for 3D printing.",
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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      </body>
    </html>
  );
}
