#!/usr/bin/env node
import * as fs from 'node:fs';

const target = process.argv[2];
if (target !== undefined && process.env['ENVLT_CAPTURE_TMP_PATH'] !== undefined) {
  fs.writeFileSync(process.env['ENVLT_CAPTURE_TMP_PATH'], target, 'utf8');
}
process.exit(1);
