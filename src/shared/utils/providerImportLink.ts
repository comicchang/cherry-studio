import * as z from 'zod'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

/**
 * cherrystudio://provider/import deep-link payload (spec v1).
 *
 * Producers encode the JSON payload as base64url in the `data` query param.
 * The payload carries no real vendor credentials: the auth key is an
 * attribution key the gateway itself accepts. Endpoint `baseUrl` values are
 * final in Cherry's endpoint_configs semantics — consumers must not append
 * version segments.
 */
export const PROVIDER_IMPORT_LINK_VERSION = 1

/** Endpoint protocols this import route can map onto Cherry endpoint types. */
export const PROVIDER_IMPORT_LINK_PROTOCOLS = [
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
] as const

export type ProviderImportLinkProtocol = (typeof PROVIDER_IMPORT_LINK_PROTOCOLS)[number]

export interface ProviderImportLinkEndpoint {
  protocol: ProviderImportLinkProtocol
  baseUrl: string
}

export interface ProviderImportLinkPayload {
  id: string
  name: string
  apiKey: string
  endpoints: ProviderImportLinkEndpoint[]
}

export type ProviderImportLinkParseResult =
  | { ok: true; payload: ProviderImportLinkPayload }
  | { ok: false; reason: string }

const ProtocolSchema = z.enum(PROVIDER_IMPORT_LINK_PROTOCOLS)

const EndpointSchema = z.object({
  protocol: ProtocolSchema,
  baseUrl: z.string().trim().min(1),
  modelsUrl: z.string().trim().optional()
})

const PayloadSchema = z.object({
  kind: z.literal('custom'),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  auth: z.object({
    method: z.literal('apiKey'),
    apiKey: z.string().min(1)
  }),
  endpoints: z.array(EndpointSchema).min(1)
})

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
  } catch {
    return false
  }
}

/**
 * Parse and validate a provider import deep-link payload. Fails closed:
 * unknown versions, malformed encoding/JSON, unknown protocols, non-http(s)
 * URLs, duplicate protocol entries, or a missing chat-completions endpoint
 * reject the whole payload with zero side effects.
 */
export function parseProviderImportLink(input: {
  version: string | null | undefined
  data: string | null | undefined
}): ProviderImportLinkParseResult {
  if (input.version !== String(PROVIDER_IMPORT_LINK_VERSION)) {
    return { ok: false, reason: `unsupported-version:${input.version ?? 'missing'}` }
  }

  if (!input.data) {
    return { ok: false, reason: 'missing-data' }
  }

  let json: unknown
  try {
    json = JSON.parse(Buffer.from(input.data, 'base64').toString('utf-8'))
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }

  const parsed = PayloadSchema.safeParse(json)
  if (!parsed.success) {
    return { ok: false, reason: 'invalid-payload' }
  }

  for (const [index, endpoint] of parsed.data.endpoints.entries()) {
    if (!isHttpUrl(endpoint.baseUrl)) {
      return { ok: false, reason: `invalid-endpoint-base-url:${index}` }
    }
    if (endpoint.modelsUrl && !isHttpUrl(endpoint.modelsUrl)) {
      return { ok: false, reason: `invalid-endpoint-models-url:${index}` }
    }
  }

  const seenProtocols = new Set<string>()
  for (const endpoint of parsed.data.endpoints) {
    if (seenProtocols.has(endpoint.protocol)) {
      return { ok: false, reason: `duplicate-protocol:${endpoint.protocol}` }
    }
    seenProtocols.add(endpoint.protocol)
  }

  if (!seenProtocols.has(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)) {
    return { ok: false, reason: 'missing-chat-completions-endpoint' }
  }

  return {
    ok: true,
    payload: {
      id: parsed.data.id,
      name: parsed.data.name,
      apiKey: parsed.data.auth.apiKey,
      endpoints: parsed.data.endpoints.map(({ protocol, baseUrl }) => ({ protocol, baseUrl }))
    }
  }
}
