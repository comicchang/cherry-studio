import { loggerService } from '@logger'
import { providerService } from '@data/services/ProviderService'
import { openSettingsInMainWindow } from '@main/services/mainWindowNavigation'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import { randomUUID } from 'node:crypto'
import {
  parseProviderImportLink,
  PROVIDER_IMPORT_LINK_VERSION,
  type ProviderImportLinkPayload
} from '@shared/utils/providerImportLink'

const logger = loggerService.withContext('ProtocolService:providerImport')

const IMPORTED_PROVIDER_ID = 'magpie'
const ATTRIBUTION_KEY_LABEL = 'magpie attribution key'

function endpointConfigsFrom(payload: ProviderImportLinkPayload) {
  const endpointConfigs: Partial<Record<EndpointType, { baseUrl: string }>> = {}
  for (const endpoint of payload.endpoints) {
    endpointConfigs[endpoint.protocol] = { baseUrl: endpoint.baseUrl }
  }
  return endpointConfigs
}

function matchesGatewayImport(provider: { endpointConfigs: Partial<Record<EndpointType, { baseUrl?: string }>> | null }, payload: ProviderImportLinkPayload) {
  const payloadBaseUrls = new Set(payload.endpoints.map((endpoint) => endpoint.baseUrl.replace(/\/+$/, '')))
  for (const config of Object.values(provider.endpointConfigs ?? {})) {
    if (config?.baseUrl && payloadBaseUrls.has(config.baseUrl.replace(/\/+$/, ''))) {
      return true
    }
  }
  return false
}

export function handleProviderImportProtocolUrl(url: URL) {
  const params = url.searchParams
  const result = parseProviderImportLink({
    version: params.get('v'),
    data: params.get('data')
  })

  if (!result.ok) {
    logger.warn('Rejected provider import deep link', { reason: result.reason })
    openSettingsInMainWindow('/settings/provider')
    return
  }

  const payload = result.payload
  // Upsert by the stable imported-provider id; a different provider that
  // already serves the same gateway baseUrls is merged too, so repeat imports
  // never create duplicate rows for one gateway.
  const existing = providerService.list({}).find(
    (provider) => provider.id === IMPORTED_PROVIDER_ID || matchesGatewayImport(provider, payload)
  )

  if (existing) {
    const mergedEndpointConfigs = { ...existing.endpointConfigs, ...endpointConfigsFrom(payload) }
    providerService.update(existing.id, {
      name: existing.id === IMPORTED_PROVIDER_ID ? payload.name : existing.name,
      endpointConfigs: mergedEndpointConfigs
    })
    // Skips internally when the key value already exists.
    providerService.addApiKey(existing.id, payload.apiKey, ATTRIBUTION_KEY_LABEL)
    logger.info('Updated provider from import deep link', { providerId: existing.id })
  } else {
    providerService.create({
      providerId: IMPORTED_PROVIDER_ID,
      name: payload.name,
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: endpointConfigsFrom(payload),
      apiKeys: [
        {
          id: randomUUID(),
          key: payload.apiKey,
          label: ATTRIBUTION_KEY_LABEL,
          isEnabled: true
        }
      ]
    })
    logger.info('Created provider from import deep link', { providerId: IMPORTED_PROVIDER_ID })
  }

  // The imported gateway serves an OpenAI-compatible /v1/models list; hand the
  // user to the provider's model list so the app's existing pull flow fetches it.
  openSettingsInMainWindow(`/settings/provider?id=${IMPORTED_PROVIDER_ID}`)
  logger.debug('handleProviderImportProtocolUrl', { version: PROVIDER_IMPORT_LINK_VERSION })
}
