const Heartbeat = require('./heartbeat')
const SharedEditor = require('./shared-editor')
const HOST_SITE_ID = 1

module.exports =
class GuestPortal {
  constructor ({id, restGateway, pubSubGateway, heartbeatIntervalInMilliseconds}) {
    this.id = id
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.siteId = null
    this.heartbeatIntervalInMilliseconds = heartbeatIntervalInMilliseconds
    this.heartbeat = null
  }

  setDelegate (delegate) {
    this.delegate = delegate
    if (this.activeSharedEditor) this.delegate.setActiveSharedEditor(this.activeSharedEditor)
  }

  async join () {
    const {siteId, activeSharedEditorId} = await this.restGateway.post(`/portals/${this.id}/sites`)
    this.siteId = siteId

    this.heartbeat = new Heartbeat({
      restGateway: this.restGateway,
      portalId: this.id,
      siteId: this.siteId,
      intervalInMilliseconds: this.heartbeatIntervalInMilliseconds
    })
    this.heartbeat.start()

    await this.subscribe()
    if (activeSharedEditorId) {
      this.activeSharedEditor = await this.joinSharedEditor(activeSharedEditorId)
    }
  }

  async joinSharedEditor (sharedEditorId) {
    const sharedEditor = new SharedEditor({
      id: sharedEditorId,
      siteId: this.siteId,
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway
    })
    await sharedEditor.join()
    return sharedEditor
  }

  async subscribe () {
    await this.pubSubGateway.subscribe(
      `/portals/${this.id}`,
      'update',
      this.receiveUpdate.bind(this)
    )
    await this.pubSubGateway.subscribe(
      `/portals/${this.id}`,
      'disconnect-site',
      this.receiveDisconnectSite.bind(this)
    )
  }

  async receiveUpdate (message) {
    const {activeSharedEditorId} = JSON.parse(message.text)
    if (activeSharedEditorId) {
      this.activeSharedEditor = await this.joinSharedEditor(activeSharedEditorId)
    } else {
      this.activeSharedEditor = null
    }
    if (this.delegate) this.delegate.setActiveSharedEditor(this.activeSharedEditor)
  }

  receiveDisconnectSite (message) {
    let {siteId} = JSON.parse(message.text)
    if (parseInt(siteId) === HOST_SITE_ID) {
      this.delegate.hostDidDisconnect()
      this.dispose()
    } else {
      if (this.activeSharedEditor) this.activeSharedEditor.siteDidDisconnect(siteId)
    }
  }

  dispose () {
    if (this.heartbeat) this.heartbeat.stop()
  }
}
