// Stub for the cpu-features native addon (used by ssh2 for CPU-specific crypto
// algorithm selection). When stubbed, ssh2 falls back to its default algorithm
// set, which is safe and correct. This avoids bundling a native .node addon
// whose relative path breaks when Vite inlines it.
'use strict';
module.exports = function getCPUInfo() {
  return {};
};
