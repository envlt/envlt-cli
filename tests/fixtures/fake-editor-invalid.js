#!/usr/bin/env node
import * as fs from 'node:fs';

const target = process.argv[2];
if (target === undefined) {
  process.exit(1);
}
fs.writeFileSync(target, 'INVALID_LINE\n', 'utf8');
process.exit(0);
