#!/bin/sh
# what: start headless Chrome for CDP screenshots of the web app
# does: launches Chrome with remote debugging on 9297 and its own profile dir
# safe: yes — read-only browser, no repo writes
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9297 --user-data-dir=/tmp/chrome-morale \
  --window-size=1600,1000 about:blank
