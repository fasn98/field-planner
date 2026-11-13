/* Field Planner — Web Worker do otimizador. Sem rede: só importa scripts locais. */
/* global importScripts, FPOptimizer */
importScripts('geo.js', 'optimizer.js');

self.onmessage = function (e) {
  var msg = e.data || {};
  if (msg.type !== 'optimize') return;
  try {
    var result = FPOptimizer.optimize(msg.input);
    self.postMessage({ type: 'result', reqId: msg.reqId, result: result });
  } catch (err) {
    self.postMessage({ type: 'error', reqId: msg.reqId, error: String(err && err.message || err) });
  }
};
