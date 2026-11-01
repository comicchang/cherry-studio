import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useProviderActions, useProviders } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { ProviderTypeSchema } from '@renderer/types/provider'
import { validateApiHost } from '@renderer/utils/api'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

import UrlSchemaInfoPopup from '../UrlSchemaInfoPopup'

const logger = loggerService.withContext('useProviderDeepLinkImport')

function resolveDefaultEndpoint(type?: string): EndpointType {
  switch (type) {
    case 'anthropic':
    case 'vertex-anthropic':
      return ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    case 'openai-response':
      return ENDPOINT_TYPE.OPENAI_RESPONSES
    case 'gemini':
    case 'vertexai':
      return ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    case 'ollama':
      return ENDPOINT_TYPE.OLLAMA_CHAT
    default:
      return ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  }
}

const ImportedProviderSearchDataSchema = z.object({
  id: z.string().min(1),
  apiKey: z.string(),
  baseUrl: z.string().min(1),
  type: ProviderTypeSchema.optional(),
  name: z.string().optional()
})

type ImportedProviderSearchData = z.infer<typeof ImportedProviderSearchDataSchema>

/** magpie gateway import payload (cherrystudio://provider/import spec v1), rendered into search-data form. */
const ImportedGatewaySearchDataSchema = z.object({
  kind: z.literal('custom'),
  id: z.string().min(1),
  name: z.string().min(1),
  auth: z.object({ method: z.literal('apiKey'), apiKey: z.string().min(1) }),
  endpoints: z
    .array(
      z.object({
        protocol: z.enum([
          ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
          ENDPOINT_TYPE.OPENAI_RESPONSES,
          ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
          ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
        ]),
        baseUrl: z.string().min(1)
      })
    )
    .min(1)
})

/** A gateway payload with one baseUrl per endpoint; the primary host feeds the confirm dialog. */
function gatewayPayloadToImportedSearchData(payload: unknown): ImportedProviderSearchData | null {
  const parsed = ImportedGatewaySearchDataSchema.safeParse(payload)
  if (!parsed.success) {
    return null
  }

  const endpoints = parsed.data.endpoints
  const baseUrl = endpoints.find((endpoint) => endpoint.protocol === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)?.baseUrl

  return {
    id: parsed.data.id,
    apiKey: parsed.data.auth.apiKey,
    baseUrl,
    name: parsed.data.name
  }
}

/** Consumes one provider deep-link import payload from the URL into create/update + add-api-key calls. */
export function useProviderDeepLinkImport(
  searchAddProviderData: string | undefined,
  onSelectProvider: (providerId: string) => void
) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { createProvider } = useProviders()
  const { updateProviderById } = useProviderActions()
  const { trigger: addApiKeyTrigger } = useMutation('POST', '/providers/:providerId/api-keys', {
    refresh: ({ args }) => [
      '/providers',
      `/providers/${args!.params.providerId}`,
      `/providers/${args!.params.providerId}/*`
    ]
  })

  useEffect(() => {
    if (!searchAddProviderData) {
      return
    }

    const importProvider = async (providerData: ImportedProviderSearchData) => {
      try {
        const popupResult = await UrlSchemaInfoPopup.show(providerData)
        const { updatedProvider, isNew, nameOnly, displayName } = popupResult

        if (!updatedProvider) {
          void navigate({ to: '/settings/provider' })
          return
        }

        const providerId = updatedProvider.id
        const defaultChatEndpoint = resolveDefaultEndpoint(updatedProvider.type)
        if (updatedProvider.apiHost && !validateApiHost(updatedProvider.apiHost)) {
          logger.warn('Rejected deep-link apiHost with invalid scheme', { providerId })
          toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
          void navigate({ to: '/settings/provider' })
          return
        }
        const endpointConfigs = updatedProvider.apiHost
          ? {
              [defaultChatEndpoint]: {
                baseUrl: updatedProvider.apiHost
              }
            }
          : undefined

        if (isNew) {
          await createProvider({
            providerId,
            name: updatedProvider.name || providerData.id,
            defaultChatEndpoint,
            endpointConfigs
          })
        } else {
          await updateProviderById(
            providerId,
            nameOnly
              ? { name: updatedProvider.name }
              : { name: updatedProvider.name, defaultChatEndpoint, endpointConfigs }
          )
        }

        if (updatedProvider.apiKey.trim()) {
          await addApiKeyTrigger({
            params: { providerId },
            body: { key: updatedProvider.apiKey.trim() }
          })
        }

        onSelectProvider(providerId)
        void navigate({ to: '/settings/provider', search: { id: providerId } })
        toast.success(t('settings.models.provider_key_added', { provider: displayName }))
      } catch (error) {
        logger.error('Failed to import provider deep link data', error as Error)
        toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
        void navigate({ to: '/settings/provider' })
      }
    }

    try {
      const json = JSON.parse(searchAddProviderData)
      const parsed = ImportedProviderSearchDataSchema.safeParse(json)

      if (parsed.success) {
        void importProvider(parsed.data)
        return
      }

      const gatewayData = gatewayPayloadToImportedSearchData(json)
      if (gatewayData) {
        void importProvider(gatewayData)
        return
      }

      toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
      void navigate({ to: '/settings/provider' })
    } catch (error) {
      logger.error('Failed to parse provider deep link import data', error as Error)
      toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
      void navigate({ to: '/settings/provider' })
    }
  }, [addApiKeyTrigger, createProvider, navigate, onSelectProvider, searchAddProviderData, t, updateProviderById])
}
