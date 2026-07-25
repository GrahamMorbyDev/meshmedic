import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: "https://mesh-medic.com/sitemap.xml",
    host: "https://mesh-medic.com",
  };
}
