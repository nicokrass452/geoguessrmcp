import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PanoramaProviderChoice } from '@geoguessr-mcp/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from repo root or web/ if present
const candidateEnvPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
  path.resolve(__dirname, '..', '..', '..', '.env'),
];

for (const envPath of candidateEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
    break;
  }
}

function parseProvider(raw: string | undefined): PanoramaProviderChoice {
  switch ((raw || '').toLowerCase()) {
    case 'open':
      return 'open';
    case 'wikimedia':
      return 'wikimedia';
    case 'mapillary':
      return 'mapillary';
    case 'google':
      return 'google';
    default:
      return 'auto';
  }
}

export interface ServerConfig {
  port: number;
  defaultProvider: PanoramaProviderChoice;
  enableWikimediaFetch: boolean;
  mapillaryAccessToken: string;
  googleMapsApiKey: string;
  cacheDir: string;
}

export function loadServerConfig(): ServerConfig {
  return {
    port: Number(process.env.PORT || 3001),
    defaultProvider: parseProvider(process.env.PANORAMA_PROVIDER),
    enableWikimediaFetch:
      String(process.env.ENABLE_WIKIMEDIA_FETCH || '').toLowerCase() === 'true',
    mapillaryAccessToken: (process.env.MAPILLARY_ACCESS_TOKEN || '').trim(),
    googleMapsApiKey: (process.env.GOOGLE_MAPS_API_KEY || '').trim(),
    cacheDir: path.resolve(__dirname, '..', '..', 'cache', 'panoramas'),
  };
}
