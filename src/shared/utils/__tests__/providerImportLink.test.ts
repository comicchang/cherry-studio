import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

import {
  parseProviderImportLink,
  PROVIDER_IMPORT_LINK_VERSION,
  type ProviderImportLinkPayload
} from '../providerImportLink'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

const gatewayPayload: ProviderImportLinkPayload = {
  id: 'magpie',
  name: 'Magpie',
  apiKey: 'magpie-cherry',
  endpoints: [
    { protocol: 'openai-chat-completions', baseUrl: 'http://127.0.0.1:3425/v1' },
    { protocol: 'openai-responses', baseUrl: 'http://127.0.0.1:3425/v1' },
    { protocol: 'anthropic-messages', baseUrl: 'http://127.0.0.1:3425/v1' },
    { protocol: 'google-generate-content', baseUrl: 'http://127.0.0.1:3425/v1beta' }
  ]
}

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url')

const parse = (payload: unknown, version = String(PROVIDER_IMPORT_LINK_VERSION)) =>
  parseProviderImportLink({ version, data: base64url(payload) })

describe('parseProviderImportLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses a well-formed v1 payload and drops the modelsUrl field from the result', () => {
    const result = parse({
      kind: 'custom',
      id: 'magpie',
      name: 'Magpie',
      auth: { method: 'apiKey', apiKey: 'magpie-cherry' },
      endpoints: [{ protocol: 'openai-chat-completions', baseUrl: 'http://127.0.0.1:3425/v1', modelsUrl: 'http://127.0.0.1:3425/v1/models' }]
    })

    expect(result).toEqual({
      ok: true,
      payload: {
        id: 'magpie',
        name: 'Magpie',
        apiKey: 'magpie-cherry',
        endpoints: [{ protocol: 'openai-chat-completions', baseUrl: 'http://127.0.0.1:3425/v1' }]
      }
    })
  })

  it('accepts LAN http addresses (no localhost-only restriction)', () => {
    const result = parse({
      kind: 'custom',
      id: 'magpie',
      name: 'Magpie',
      auth: { method: 'apiKey', apiKey: 'k' },
      endpoints: [{ protocol: 'openai-chat-completions', baseUrl: 'http://192.168.234.18:3425/v1' }]
    })

    expect(result.ok).toBe(true)
  })

  it.each(['2', '0', 'banana', ''])('fails closed on unknown version %s', (version) => {
    expect(parse(gatewayPayload, version)).toEqual({
      ok: false,
      reason: `unsupported-version:${version}`
    })
  })

  it('fails closed on a missing version', () => {
    expect(parseProviderImportLink({ version: null, data: base64url(gatewayPayload) })).toEqual({
      ok: false,
      reason: 'unsupported-version:missing'
    })
  })

  it('fails closed on missing data', () => {
    expect(parseProviderImportLink({ version: '1', data: null })).toEqual({ ok: false, reason: 'missing-data' })
  })

  it('fails closed on malformed base64 or JSON', () => {
    expect(parseProviderImportLink({ version: '1', data: '%%%not-base64-json' })).toEqual({
      ok: false,
      reason: 'invalid-json'
    })
  })

  it('fails closed when the payload shape does not match the schema', () => {
    expect(parse({ id: 'magpie' })).toEqual({ ok: false, reason: 'invalid-payload' })
    expect(parse({ ...gatewayPayload, auth: { method: 'none', apiKey: 'k' } })).toEqual({
      ok: false,
      reason: 'invalid-payload'
    })
    expect(parse({ ...gatewayPayload, endpoints: [] })).toEqual({ ok: false, reason: 'invalid-payload' })
  })

  it('fails closed on unknown endpoint protocols', () => {
    const result = parse({
      kind: 'custom',
      id: 'magpie',
      name: 'Magpie',
      auth: { method: 'apiKey', apiKey: 'k' },
      endpoints: [{ protocol: 'ollama-chat', baseUrl: 'http://127.0.0.1:3425/v1' }]
    })

    expect(result).toEqual({ ok: false, reason: 'invalid-payload' })
  })

  it.each([
    ['ftp scheme', 'ftp://127.0.0.1:3425/v1'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['file scheme', 'file:///etc/passwd'],
    ['not a url', 'not-a-url']
  ])('fails closed on non-http(s) baseUrl %s', (_label, baseUrl) => {
    const result = parse({
      kind: 'custom',
      id: 'magpie',
      name: 'Magpie',
      auth: { method: 'apiKey', apiKey: 'k' },
      endpoints: [{ protocol: 'openai-chat-completions', baseUrl }]
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid-endpoint-base-url:0')
  })

  it('fails closed on a non-http(s) modelsUrl', () => {
    const result = parse({
      kind: 'custom',
      id: 'magpie',
      name: 'Magpie',
      auth: { method: 'apiKey', apiKey: 'k' },
      endpoints: [
        {
          protocol: 'openai-chat-completions',
          baseUrl: 'http://127.0.0.1:3425/v1',
          modelsUrl: 'javascript:alert(1)'
        }
      ]
    })

    expect(result).toEqual({ ok: false, reason: 'invalid-endpoint-models-url:0' })
  })

  it('fails closed on duplicate protocol entries', () => {
    const result = parse({
      kind: 'custom',
      id: 'magpie',
      name: 'Magpie',
      auth: { method: 'apiKey', apiKey: 'k' },
      endpoints: [
        { protocol: 'openai-chat-completions', baseUrl: 'http://127.0.0.1:3425/v1' },
        { protocol: 'openai-chat-completions', baseUrl: 'http://127.0.0.1:9999/v1' }
      ]
    })

    expect(result).toEqual({ ok: false, reason: `duplicate-protocol:${ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS}` })
  })

  it('fails closed when no chat-completions endpoint is present', () => {
    const result = parse({
      kind: 'custom',
      id: 'magpie',
      name: 'Magpie',
      auth: { method: 'apiKey', apiKey: 'k' },
      endpoints: [{ protocol: 'openai-responses', baseUrl: 'http://127.0.0.1:3425/v1' }]
    })

    expect(result).toEqual({ ok: false, reason: 'missing-chat-completions-endpoint' })
  })
})
