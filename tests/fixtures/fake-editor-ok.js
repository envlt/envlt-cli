#!/usr/bin/env node
import * as fs from 'node:fs';

const target = process.argv[2];
if (target === undefined) {
  process.exit(1);
}

const capturePath = process.env['ENVLT_CAPTURE_TMP_PATH'];
if (capturePath !== undefined) {
  fs.writeFileSync(capturePath, target, 'utf8');
}

const captureMode = process.env['ENVLT_CAPTURE_TMP_MODE'];
if (captureMode !== undefined) {
  const stats = fs.statSync(target);
  fs.writeFileSync(captureMode, String(stats.mode & 0o777), 'utf8');
}

fs.writeFileSync(target, 'FOO=edited\n', 'utf8');
process.exit(0);
