import { ipcApi } from '@renderer/ipc'

import { openExternalWebsite } from './website'

/** Tells the page the visit came from the desktop client, and from which touchpoint and subscription flow. */
type PageAttribution = { entrySource?: string; flowId?: string }

// Cherry Cloud web pages are served by the same origin as its API in every environment.
async function openCherryCloudPage(path: string, { entrySource, flowId }: PageAttribution = {}): Promise<void> {
  const url = new URL(path, await ipcApi.request('cherry_cloud.api_origin.get'))
  url.searchParams.set('entry', 'desktop')
  if (entrySource) url.searchParams.set('entry_source', entrySource)
  if (flowId) url.searchParams.set('flow_id', flowId)
  return openExternalWebsite(url.toString())
}

export function openCherryCloudAccountPortal(attribution: PageAttribution = {}): Promise<void> {
  return openCherryCloudPage('/account/plans', attribution)
}

/** Placeholder path until the web team provides the subscription FAQ page. */
export function openCherryCloudFaq(): Promise<void> {
  return openCherryCloudPage('/account/faq')
}
