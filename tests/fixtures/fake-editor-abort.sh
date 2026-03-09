#!/bin/sh
if [ -n "$ENVLT_CAPTURE_TMP_PATH" ]; then
  printf '%s' "$1" > "$ENVLT_CAPTURE_TMP_PATH"
fi
exit 1
