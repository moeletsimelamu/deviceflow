import path from 'node:path';
import { buildOpenApiDocument } from './openapi.js';

/** docs/openapi.json at the repository root. Development tooling only. */
export const OPENAPI_FILE = path.resolve(import.meta.dirname, '../../../../docs/openapi.json');

export function renderOpenApiFile(): string {
  return JSON.stringify(buildOpenApiDocument(), null, 2) + '\n';
}
