import type { MetadataRoute } from "next";

/** Lets staff "Add to Home Screen" so Grandview OS opens full-screen like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Grandview OS",
    short_name: "Grandview",
    description: "Grandview Painting's business system",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f6f9",
    theme_color: "#100599",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
