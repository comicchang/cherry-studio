import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerMock, openSettingsInMainWindowMock, providerServiceMock } = vi.hoisted(() => {
  const openSettingsInMainWindowMock = vi.fn()
  const loggerMock = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
  const providerServiceMock = {
    list: vi.fn(() => []),
    create: vi.fn(),
    update: vi.fn(),
    addApiKey: vi.fn()
  }
  return { loggerMock, openSettingsInMainWindowMock, providerServiceMock }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('@main/services/mainWindowNavigation', () => ({
  openSettingsInMainWindow: openSettingsInMainWindowMock
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: providerServiceMock
}))

import { handleProviderImportProtocolUrl } from '../providerImport'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

const encodePayload = (payload: unknown) =>
  Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url')

const gatewayPayload = {
  kind: 'custom',
  id: 'magpie',
  name: 'Magpie',
  auth: { method: 'apiKey', apiKey: 'magpie-cherry' },
  endpoints: [
    { protocol: 'openai-chat-completions', baseUrl: 'http://127.0.0.1:3425/v1' },
    { protocol: 'openai-responses', baseUrl: 'http://127.0.0.1:3425/v1' },
    { protocol: 'anthropic-messages', baseUrl: 'http://127.0.0.1:3425/v1' },
    { protocol: 'google-generate-content', baseUrl: 'http://127.0.0.1:3425/v1beta' }
  ]
}

const importUrl = (payload: unknown = gatewayPayload, version = '1') =>
  new URL(`cherrystudio://provider/import?v=${version}&data=${encodePayload(payload)}`)

describe('providerImport protocol handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerServiceMock.list.mockReturnValue([])
  })

  it('creates the magpie provider with endpoint configs and the attribution key', () => {
    handleProviderImportProtocolUrl(importUrl())

    expect(providerServiceMock.create).toHaveBeenCalledTimes(1)
    const dto = providerServiceMock.create.mock.calls[0][0]
    expect(dto.providerId).toBe('magpie')
    expect(dto.name).toBe('Magpie')
    expect(dto.defaultChatEndpoint).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    expect(dto.endpointConfigs).toEqual({
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'http://127.0.0.1:3425/v1' },
      [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'http://127.0.0.1:3425/v1' },
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'http://127.0.0.1:3425/v1' },
      [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'http://127.0.0.1:3425/v1beta' }
    })
    expect(dto.apiKeys).toHaveLength(1)
    expect(dto.apiKeys[0].key).toBe('magpie-cherry')
    expect(openSettingsInMainWindowMock).toHaveBeenCalledWith('/settings/provider?id=magpie')
  })

  it('updates the existing magpie provider instead of creating a duplicate', () => {
    providerServiceMock.list.mockReturnValue([
      {
        id: 'magpie',
        name: 'Magpie (old)',
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'http://127.0.0.1:3425/v1' } },
        apiKeys: []
      }
    ])

    handleProviderImportProtocolUrl(importUrl())

    expect(providerServiceMock.create).not.toHaveBeenCalled()
    expect(providerServiceMock.update).toHaveBeenCalledWith('magpie', expect.objectContaining({ name: 'Magpie' }))
    expect(providerServiceMock.addApiKey).toHaveBeenCalledWith('magpie', 'magpie-cherry', 'magpie attribution key')
  })

  it('merges into a differently-named provider that already serves the same gateway baseUrl', () => {
    providerServiceMock.list.mockReturnValue([
      {
        id: 'my-gateway',
        name: 'My Gateway',
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'http://192.168.234.18:3425/v1/' } },
        apiKeys: []
      }
    ])

    const lanPayload = {
      ...gatewayPayload,
      endpoints: [{ protocol: 'openai-chat-completions', baseUrl: 'http://192.168.234.18:3425/v1' }]
    }

    handleProviderImportProtocolUrl(importUrl(lanPayload))

    expect(providerServiceMock.create).not.toHaveBeenCalled()
    expect(providerServiceMock.update).toHaveBeenCalledWith('my-gateway', expect.anything())
    // A foreign provider keeps its own display name.
    expect(providerServiceMock.update.mock.calls[0][1].name).toBe('My Gateway')
  })

  it.each([
    ['unsupported version', importUrl(gatewayPayload, '2'), 'unsupported-version:2'],
    ['missing data param', new URL('cherrystudio://provider/import?v=1'), 'missing-data'],
    ['malformed base64/json', new URL('cherrystudio://provider/import?v=1&data=%%%not-json'), 'invalid-json']
  ])('fails closed on %s with zero writes', (_label, url, reason) => {
    handleProviderImportProtocolUrl(url)

    expect(providerServiceMock.create).not.toHaveBeenCalled()
    expect(providerServiceMock.update).not.toHaveBeenCalled()
    expect(providerServiceMock.addApiKey).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalledWith('Rejected provider import deep link', { reason })
  })

  it('rejects unknown endpoint protocols with zero writes', () => {
    const payload = {
      ...gatewayPayload,
      endpoints: [{ protocol: 'ollama-chat', baseUrl: 'http://127.0.0.1:3425/v1' }]
    }

    handleProviderImportProtocolUrl(importUrl(payload))

    expect(providerServiceMock.create).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalledWith('Rejected provider import deep link', {
      reason: 'invalid-payload'
    })
  })

  it.each([
    ['ftp scheme', 'ftp://127.0.0.1:3425/v1'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['not a url', 'not-a-url']
  ])('rejects non-http(s) endpoint baseUrl %s with zero writes', (_label, baseUrl) => {
    const payload = {
      ...gatewayPayload,
      endpoints: [{ protocol: 'openai-chat-completions', baseUrl }]
    }

    handleProviderImportProtocolUrl(importUrl(payload))

    expect(providerServiceMock.create).not.toHaveBeenCalled()
    expect(providerServiceMock.update).not.toHaveBeenCalled()
  })

  it('rejects payloads without a chat-completions endpoint', () => {
    const payload = {
      ...gatewayPayload,
      endpoints: [{ protocol: 'openai-responses', baseUrl: 'http://127.0.0.1:3425/v1' }]
    }

    handleProviderImportProtocolUrl(importUrl(payload))

    expect(providerServiceMock.create).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalledWith('Rejected provider import deep link', {
      reason: 'missing-chat-completions-endpoint'
    })
  })

  it('allows LAN http gateway addresses', () => {
    const lanPayload = {
      ...gatewayPayload,
      endpoints: [{ protocol: 'openai-chat-completions', baseUrl: 'http://192.168.234.18:3425/v1' }]
    }

    handleProviderImportProtocolUrl(importUrl(lanPayload))

    expect(providerServiceMock.create).toHaveBeenCalledTimes(1)
  })
})
