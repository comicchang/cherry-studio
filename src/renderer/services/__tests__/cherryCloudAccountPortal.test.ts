import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openCherryCloudAccountPortal, openCherryCloudFaq } from '../cherryCloudAccountPortal'

const request = vi.mocked(window.api.ipcApi.request)

function useApiOrigin(origin: string) {
  request.mockImplementation(async (route) =>
    route === 'cherry_cloud.api_origin.get' ? { ok: true, data: origin } : { ok: true, data: undefined }
  )
}

describe('openCherryCloudAccountPortal', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['https://cloud.cherryai.com.cn', 'https://cloud.cherryai.com.cn/account/plans'],
    ['https://cloud.cherryai.com', 'https://cloud.cherryai.com/account/plans'],
    ['http://192.168.1.176:8284', 'http://192.168.1.176:8284/account/plans']
  ])('opens the portal matching the %s backend', async (apiOrigin, portalUrl) => {
    useApiOrigin(apiOrigin)

    await openCherryCloudAccountPortal()

    expect(request).toHaveBeenCalledWith('system.shell.open_external_website', `${portalUrl}?entry=desktop`)
  })

  it('tells the portal which touchpoint and subscription flow the visit came from', async () => {
    useApiOrigin('https://cloud.cherryai.com.cn')

    await openCherryCloudAccountPortal({ entrySource: 'quota_notice', flowId: 'f1' })

    expect(request).toHaveBeenCalledWith(
      'system.shell.open_external_website',
      'https://cloud.cherryai.com.cn/account/plans?entry=desktop&entry_source=quota_notice&flow_id=f1'
    )
  })

  it('opens the FAQ on the same origin as the portal', async () => {
    useApiOrigin('https://cloud.cherryai.com.cn')

    await openCherryCloudFaq()

    expect(request).toHaveBeenCalledWith(
      'system.shell.open_external_website',
      'https://cloud.cherryai.com.cn/account/faq?entry=desktop'
    )
  })
})
