// Runs once when the Next.js server starts. Node-only code lives in instrumentation-node.js so the
// edge bundle doesn't try to compile it.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
