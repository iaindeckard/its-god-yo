import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://itsgodyo.com";
  const paths = [
    "",
    "/pricing",
    "/sample",
    "/privacy",
    "/terms",
    "/cookies",
    "/program-terms",
    "/its-okay-to-not-be-okay",
    "/cornerstone",
    "/cornerstone-partners",
  ];

  return paths.map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path === "" || path === "/pricing" ? "weekly" : "monthly",
    priority: path === "" ? 1 : path === "/pricing" || path === "/sample" ? 0.8 : 0.5,
  }));
}
