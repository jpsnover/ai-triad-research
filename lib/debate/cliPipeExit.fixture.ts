// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1824 repro harness — NOT a test (spawned as a child process by cliPipeExit.test.ts).
//
// Replicates the debate CLI's lifecycle-relevant wiring: start the flight-recorder named-pipe
// listener (as cli.ts main() does via recorder.startPipeListener), emit the final result line (as
// main() ends with console.log(JSON.stringify(result))), then reach end-of-program. With `--fix`,
// release the listener (the t/1824 fix) so the event loop drains and the process exits 0; without
// it, the live net.Server handle pins the loop and the process never exits — exactly the batch-run
// hang. Deliberately does NO explicit process.exit: natural drain is the whole point.

import { FlightRecorder, setGlobalRecorder, getGlobalRecorder } from '../flight-recorder/index.js';

const rec = new FlightRecorder({ capacity: 64, dumpOnError: false });
setGlobalRecorder(rec);
rec.startPipeListener(process.pid);

// Stand-in for main()'s final `console.log(JSON.stringify(result))`.
console.log(JSON.stringify({ success: true, marker: 'finalized' }));

if (process.argv.includes('--fix')) {
  getGlobalRecorder()?.stopPipeListener();
}
