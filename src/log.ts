// Minimal timestamped logger. LOG_LEVEL=debug shows page errors and more.

const debugOn = (process.env.LOG_LEVEL ?? '').toLowerCase() === 'debug';
const ts = () => new Date().toISOString();

export const log = {
  debug: (...a: unknown[]) => {
    if (debugOn) console.log(ts(), 'DEBUG', ...a);
  },
  info: (...a: unknown[]) => console.log(ts(), 'INFO ', ...a),
  warn: (...a: unknown[]) => console.warn(ts(), 'WARN ', ...a),
  error: (...a: unknown[]) => console.error(ts(), 'ERROR', ...a),
};
