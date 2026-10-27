import { Module, VersioningType, INestApplication } from '@nestjs/common';

export interface ApiPropertyOptions {
  description?: string;
  example?: unknown;
  required?: boolean;
  type?: string | Function | [Function];
  enum?: unknown[];
  format?: string;
  nullable?: boolean;
  deprecated?: boolean;
  minimum?: number;
  maximum?: number;
}

export interface ApiOperationOptions {
  summary: string;
  description?: string;
  operationId?: string;
  deprecated?: boolean;
}

export interface ApiParamOptions {
  name: string;
  description?: string;
  required?: boolean;
  type?: string | Function;
  example?: unknown;
}

export interface ApiQueryOptions {
  name: string;
  description?: string;
  required?: boolean;
  type?: string | Function;
  enum?: string[];
  example?: unknown;
}

export interface ApiBodyOptions {
  type?: Function | string;
  description?: string;
  required?: boolean;
}

export interface ApiResponseOptions {
  status: number;
  description?: string;
  type?: Function | [Function] | string;
  headers?: Record<string, { description: string; schema: { type: string; example?: string } }>;
}

export interface ApiDeprecationOptions {
  sinceVersion: string;
  sunsetDate: string;
  replacementPath?: string;
  noticeDays?: number;
}

const DTO_REGISTRY = new Map<string, { target: Function; properties: Record<string, ApiPropertyOptions> }>();
const CONTROLLER_REGISTRY = new Set<Function>();

const META_TAGS = 'openapi:tags';
const META_OPERATION = 'openapi:operation';
const META_PARAMS = 'openapi:params';
const META_QUERIES = 'openapi:queries';
const META_BODY = 'openapi:body';
const META_RESPONSES = 'openapi:responses';
const META_DEPRECATED = 'openapi:deprecated';
const META_SECURITY = 'openapi:security';

export function ApiProperty(options: ApiPropertyOptions = {}): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const ctor = target.constructor as Function;
    const schemaName = ctor.name;
    const existing = DTO_REGISTRY.get(schemaName) || { target: ctor, properties: {} };
    existing.properties[String(propertyKey)] = {
      required: options.required !== false,
      ...options,
    };
    DTO_REGISTRY.set(schemaName, existing);
  };
}

export function ApiPropertyOptional(options: ApiPropertyOptions = {}): PropertyDecorator {
  return ApiProperty({ ...options, required: false });
}

export function ApiTags(...tags: string[]): ClassDecorator & MethodDecorator {
  return (target: Object, propertyKey?: string | symbol) => {
    if (propertyKey) {
      Reflect.defineMetadata(META_TAGS, tags, target, propertyKey);
    } else {
      Reflect.defineMetadata(META_TAGS, tags, target);
      CONTROLLER_REGISTRY.add(target as Function);
    }
  };
}

export function ApiBearerAuth(name = 'BearerAuth'): ClassDecorator & MethodDecorator {
  return (target: Object, propertyKey?: string | symbol) => {
    if (propertyKey) {
      Reflect.defineMetadata(META_SECURITY, [{ [name]: [] }], target, propertyKey);
    } else {
      Reflect.defineMetadata(META_SECURITY, [{ [name]: [] }], target);
      CONTROLLER_REGISTRY.add(target as Function);
    }
  };
}

export function ApiOperation(options: ApiOperationOptions): MethodDecorator {
  return (target: Object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(META_OPERATION, options, target, propertyKey);
    CONTROLLER_REGISTRY.add(target.constructor as Function);
    return descriptor;
  };
}

export function ApiParam(options: ApiParamOptions): MethodDecorator {
  return (target: Object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const existing: ApiParamOptions[] = Reflect.getMetadata(META_PARAMS, target, propertyKey) || [];
    Reflect.defineMetadata(META_PARAMS, [...existing, options], target, propertyKey);
    return descriptor;
  };
}

export function ApiQuery(options: ApiQueryOptions): MethodDecorator {
  return (target: Object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const existing: ApiQueryOptions[] = Reflect.getMetadata(META_QUERIES, target, propertyKey) || [];
    Reflect.defineMetadata(META_QUERIES, [...existing, options], target, propertyKey);
    return descriptor;
  };
}

export function ApiBody(options: ApiBodyOptions): MethodDecorator {
  return (target: Object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(META_BODY, options, target, propertyKey);
    return descriptor;
  };
}

export function ApiResponse(options: ApiResponseOptions): MethodDecorator {
  return (target: Object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const existing: ApiResponseOptions[] = Reflect.getMetadata(META_RESPONSES, target, propertyKey) || [];
    Reflect.defineMetadata(META_RESPONSES, [...existing, options], target, propertyKey);
    return descriptor;
  };
}

export function ApiDeprecated(options: ApiDeprecationOptions): MethodDecorator {
  return (target: Object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(META_DEPRECATED, options, target, propertyKey);
    return descriptor;
  };
}

export class DocumentBuilder {
  private spec: Record<string, unknown> = {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
    info: {
      title: 'Verinode Vesting Vault API',
      version: '1.0.0',
      description: 'OpenAPI 3.1 specification for the Verinode Vesting Vault API',
    },
    servers: [],
    tags: [],
    components: {
      securitySchemes: {},
      schemas: {},
    },
  };

  setTitle(title: string): this {
    (this.spec.info as Record<string, unknown>).title = title;
    return this;
  }

  setDescription(description: string): this {
    (this.spec.info as Record<string, unknown>).description = description;
    return this;
  }

  setVersion(version: string): this {
    (this.spec.info as Record<string, unknown>).version = version;
    return this;
  }

  setOpenAPIVersion(version: string): this {
    this.spec.openapi = version;
    return this;
  }

  addServer(url: string, description?: string): this {
    (this.spec.servers as Array<Record<string, unknown>>).push({ url, description });
    return this;
  }

  addTag(name: string, description?: string): this {
    (this.spec.tags as Array<Record<string, unknown>>).push({ name, description });
    return this;
  }

  addBearerAuth(
    options: Record<string, unknown> = { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    name = 'BearerAuth'
  ): this {
    const components = this.spec.components as Record<string, Record<string, unknown>>;
    components.securitySchemes[name] = options;
    return this;
  }

  addApiKey(
    options: Record<string, unknown> = { type: 'apiKey', in: 'header', name: 'x-user-address' },
    name = 'XUserAddress'
  ): this {
    const components = this.spec.components as Record<string, Record<string, unknown>>;
    components.securitySchemes[name] = options;
    return this;
  }

  build(): Record<string, unknown> {
    return structuredClone(this.spec);
  }
}

function resolveOpenApiPropertyType(opt: ApiPropertyOptions): Record<string, unknown> {
  let baseType = 'string';
  if (typeof opt.type === 'string') {
    baseType = opt.type;
  } else if (opt.type === Number) {
    baseType = 'number';
  } else if (opt.type === Boolean) {
    baseType = 'boolean';
  } else if (Array.isArray(opt.type)) {
    const itemType = opt.type[0];
    const itemSchema =
      typeof itemType === 'function' && DTO_REGISTRY.has(itemType.name)
        ? { $ref: `#/components/schemas/${itemType.name}` }
        : { type: 'string' };
    return {
      type: opt.nullable ? ['array', 'null'] : 'array',
      items: itemSchema,
      ...(opt.description ? { description: opt.description } : {}),
      ...(opt.example !== undefined ? { examples: [opt.example] } : {}),
    };
  } else if (typeof opt.type === 'function' && DTO_REGISTRY.has(opt.type.name)) {
    return {
      $ref: `#/components/schemas/${opt.type.name}`,
      ...(opt.description ? { description: opt.description } : {}),
    };
  }

  const propSchema: Record<string, unknown> = {
    type: opt.nullable ? [baseType, 'null'] : baseType,
  };
  if (opt.description) propSchema.description = opt.description;
  if (opt.format) propSchema.format = opt.format;
  if (opt.enum) propSchema.enum = opt.enum;
  if (opt.minimum !== undefined) propSchema.minimum = opt.minimum;
  if (opt.maximum !== undefined) propSchema.maximum = opt.maximum;
  if (opt.deprecated) propSchema.deprecated = true;
  if (opt.example !== undefined) propSchema.examples = [opt.example];
  return propSchema;
}

export class SwaggerModule {
  static createDocument(
    _app: INestApplication | null,
    config: Record<string, unknown>
  ): Record<string, unknown> {
    const doc = structuredClone(config) as {
      openapi: string;
      jsonSchemaDialect: string;
      info: Record<string, unknown>;
      servers: unknown[];
      tags: unknown[];
      paths: Record<string, Record<string, unknown>>;
      components: {
        securitySchemes: Record<string, unknown>;
        schemas: Record<string, unknown>;
      };
    };
    doc.openapi = '3.1.0';
    doc.jsonSchemaDialect = 'https://spec.openapis.org/oas/3.1/dialect/base';
    doc.paths = doc.paths || {};
    doc.components = doc.components || { securitySchemes: {}, schemas: {} };
    doc.components.schemas = doc.components.schemas || {};

    for (const [schemaName, entry] of DTO_REGISTRY.entries()) {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [propKey, propOpt] of Object.entries(entry.properties)) {
        properties[propKey] = resolveOpenApiPropertyType(propOpt);
        if (propOpt.required !== false) {
          required.push(propKey);
        }
      }
      doc.components.schemas[schemaName] = {
        type: 'object',
        ...(required.length > 0 ? { required } : {}),
        properties,
      };
    }

    const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

    for (const controllerCtor of CONTROLLER_REGISTRY) {
      const rawPrefix: string = Reflect.getMetadata('path', controllerCtor) || '';
      const rawVersion: string | string[] = Reflect.getMetadata('__version__', controllerCtor) || '1';
      const versions = Array.isArray(rawVersion) ? rawVersion : [rawVersion];
      const classTags: string[] = Reflect.getMetadata(META_TAGS, controllerCtor) || [];
      const classSecurity = Reflect.getMetadata(META_SECURITY, controllerCtor);

      const proto = controllerCtor.prototype;
      const methodNames = Object.getOwnPropertyNames(proto).filter((name) => name !== 'constructor');

      for (const methodName of methodNames) {
        const operation: ApiOperationOptions | undefined = Reflect.getMetadata(
          META_OPERATION,
          proto,
          methodName
        );
        if (!operation) continue;

        const routePath: string = Reflect.getMetadata('path', proto[methodName]) ?? '';
        const requestMethodIdx: number = Reflect.getMetadata('method', proto[methodName]) ?? 0;
        const httpMethod = HTTP_METHODS[requestMethodIdx] || 'get';
        const methodVersion: string | string[] | undefined = Reflect.getMetadata(
          '__version__',
          proto[methodName]
        );
        const targetVersions = methodVersion
          ? Array.isArray(methodVersion)
            ? methodVersion
            : [methodVersion]
          : versions;

        const methodTags: string[] = Reflect.getMetadata(META_TAGS, proto, methodName) || classTags;
        const params: ApiParamOptions[] = Reflect.getMetadata(META_PARAMS, proto, methodName) || [];
        const queries: ApiQueryOptions[] = Reflect.getMetadata(META_QUERIES, proto, methodName) || [];
        const body: ApiBodyOptions | undefined = Reflect.getMetadata(META_BODY, proto, methodName);
        const responses: ApiResponseOptions[] =
          Reflect.getMetadata(META_RESPONSES, proto, methodName) || [];
        const deprecation: ApiDeprecationOptions | undefined = Reflect.getMetadata(
          META_DEPRECATED,
          proto,
          methodName
        );
        const methodSecurity =
          Reflect.getMetadata(META_SECURITY, proto, methodName) || classSecurity;

        for (const ver of targetVersions) {
          const cleanPrefix = rawPrefix.replace(/^\/+|\/+$/g, '');
          const cleanRoute = String(routePath)
            .replace(/^\/+|\/+$/g, '')
            .replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
          const fullPath = `/api/v${ver}/${cleanPrefix}${cleanRoute ? `/${cleanRoute}` : ''}`;

          doc.paths[fullPath] = doc.paths[fullPath] || {};

          const parameters = [
            ...params.map((p) => ({
              name: p.name,
              in: 'path',
              required: p.required !== false,
              description: p.description,
              schema: {
                type: typeof p.type === 'string' ? p.type : 'string',
                ...(p.example !== undefined ? { examples: [p.example] } : {}),
              },
            })),
            ...queries.map((q) => ({
              name: q.name,
              in: 'query',
              required: Boolean(q.required),
              description: q.description,
              schema: {
                type: typeof q.type === 'string' ? q.type : 'string',
                ...(q.enum ? { enum: q.enum } : {}),
                ...(q.example !== undefined ? { examples: [q.example] } : {}),
              },
            })),
          ];

          const responsesObj: Record<string, unknown> = {};
          for (const resp of responses) {
            const schemaRef =
              typeof resp.type === 'function'
                ? { $ref: `#/components/schemas/${resp.type.name}` }
                : Array.isArray(resp.type) && typeof resp.type[0] === 'function'
                ? {
                    type: 'array',
                    items: { $ref: `#/components/schemas/${resp.type[0].name}` },
                  }
                : { type: 'object' };

            const headers: Record<string, unknown> = { ...(resp.headers || {}) };
            if (deprecation || operation.deprecated) {
              headers.Deprecation = {
                description: 'Indicates that the endpoint is deprecated (RFC 8594)',
                schema: { type: 'string', examples: ['true'] },
              };
              headers.Sunset = {
                description: 'HTTP-date after which the endpoint will be retired (RFC 8594)',
                schema: {
                  type: 'string',
                  format: 'date-time',
                  examples: [deprecation?.sunsetDate || 'Wed, 30 Sep 2026 23:59:59 GMT'],
                },
              };
            }

            responsesObj[String(resp.status)] = {
              description: resp.description || 'Response',
              ...(Object.keys(headers).length > 0 ? { headers } : {}),
              content: {
                'application/json': {
                  schema: schemaRef,
                },
              },
            };
          }

          const operationObj: Record<string, unknown> = {
            tags: methodTags,
            summary: operation.summary,
            ...(operation.description ? { description: operation.description } : {}),
            operationId:
              operation.operationId || `${controllerCtor.name}_${methodName}_v${ver}`,
            ...(parameters.length > 0 ? { parameters } : {}),
            ...(body
              ? {
                  requestBody: {
                    required: body.required !== false,
                    description: body.description,
                    content: {
                      'application/json': {
                        schema:
                          typeof body.type === 'function'
                            ? { $ref: `#/components/schemas/${body.type.name}` }
                            : { type: 'object' },
                      },
                    },
                  },
                }
              : {}),
            responses: responsesObj,
          };

          if (deprecation || operation.deprecated) {
            operationObj.deprecated = true;
            if (deprecation) {
              operationObj['x-deprecation-policy'] = {
                sinceVersion: deprecation.sinceVersion,
                sunsetDate: deprecation.sunsetDate,
                replacementPath: deprecation.replacementPath,
                noticeDays: deprecation.noticeDays ?? 90,
              };
            }
          }
          if (methodSecurity) {
            operationObj.security = methodSecurity;
          }

          doc.paths[fullPath][httpMethod] = operationObj;
        }
      }
    }

    return doc;
  }

  static configureVersioning(app: INestApplication): void {
    app.enableVersioning({
      type: VersioningType.URI,
      prefix: 'api/v',
      defaultVersion: '1',
    });
  }
}

@Module({})
export class OpenApiSwaggerModule {}
