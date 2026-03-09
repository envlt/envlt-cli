#!/bin/sh
if [ -n "$ENVLT_CAPTURE_TMP_PATH" ]; then
  printf '%s' "$1" > "$ENVLT_CAPTURE_TMP_PATH"
fi
if [ -n "$ENVLT_CAPTURE_TMP_MODE" ]; then
  node -e "const fs=require('node:fs'); const stat=fs.statSync(process.argv[1]); fs.writeFileSync(process.argv[2], String(stat.mode & 0o777));" "$1" "$ENVLT_CAPTURE_TMP_MODE"
fi
echo "FOO=edited" > "$1"
exit 0
