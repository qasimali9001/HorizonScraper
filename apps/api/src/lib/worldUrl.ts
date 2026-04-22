export function normalizeWorldUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.hostname !== "horizon.meta.com") {
    throw new Error("invalid_world_url_host");
  }
  if (!url.pathname.toLowerCase().startsWith("/world/")) {
    throw new Error("invalid_world_url_path");
  }
  url.hash = "";
  url.search = "";
  const s = url.toString();
  return s.endsWith("/") ? s : `${s}/`;
}

export function extractWorldSlugOrId(worldUrl: string): string {
  const url = new URL(worldUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  // /world/<id>[/...]
  const idx = parts.findIndex((p) => p.toLowerCase() === "world");
  const id = parts[idx + 1];
  if (!id) throw new Error("invalid_world_url_no_id");
  return id;
}

