import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Home CCTV",
    short_name: "CCTV",
    description: "Private home CCTV hub",
    start_url: "/",
    display: "standalone",
    background_color: "#070a0e",
    theme_color: "#070a0e",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
