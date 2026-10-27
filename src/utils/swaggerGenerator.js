const path = require('path');
const {
  generateSwagger: generateBackendSwagger,
  diffOpenApiSpecs,
} = require('../../backend/src/swagger/swaggerGenerator');

function generateSwagger(outputPath) {
  const defaultOut = outputPath || path.resolve(__dirname, '../../backend/openapi.json');
  return generateBackendSwagger(defaultOut);
}

module.exports = {
  generateSwagger,
  diffOpenApiSpecs,
};
