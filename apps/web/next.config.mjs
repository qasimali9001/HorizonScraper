/** @type {import('next').NextConfig} */
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..", "..");

const nextConfig = {
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
