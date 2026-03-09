#!/usr/bin/env node
import * as fs from 'node:fs';

const target = process.argv[2];
if (target === undefined) {
  process.exit(1);
}
try {
  fs.unlinkSync(target);
} catch {
  // noop
}
process.exit(0);
