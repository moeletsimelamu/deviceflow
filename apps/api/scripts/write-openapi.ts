/**
 * Writes docs/openapi.json from the Zod-based API description.
 * Run `npm run openapi -w @deviceflow/api` after changing an endpoint;
 * test/integration/openapi.test.ts fails while the committed file is stale.
 */
import { writeFileSync } from 'node:fs';
import { OPENAPI_FILE, renderOpenApiFile } from '../src/http/openapi-file.js';

writeFileSync(OPENAPI_FILE, renderOpenApiFile());
console.log(`Wrote ${OPENAPI_FILE}`);
