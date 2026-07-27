import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MeshMedic — STL, OBJ & 3MF Repair",
    short_name: "MeshMedic",
    description: "Inspect and repair common STL, OBJ and 3MF mesh problems privately in your browser.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f5f1",
    theme_color: "#111715",
    icons: [
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
