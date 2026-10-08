// Runtime bridge: the application entrypoint remains CommonJS, while the
// SEP-10 implementation lives in TypeScript as required by issue #1.
require("ts-node/register/transpile-only");

const authentication = require("./authentication.ts");

module.exports = authentication.sep10AuthMiddleware;
module.exports.Sep10AuthMiddleware = authentication.Sep10AuthMiddleware;
