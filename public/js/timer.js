// setInterval that keeps running at full speed in background tabs (browsers throttle the
// main-thread version to 1 Hz there, which would freeze the host's room and stutter the music).
export function workerInterval(ms, fn) {
  try {
    const src = `setInterval(() => postMessage(0), ${Math.round(ms)});`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = fn;
    return () => worker.terminate();
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}
