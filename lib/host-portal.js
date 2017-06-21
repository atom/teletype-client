const Heartbeat = require('./heartbeat')
const SharedBuffer = require('./shared-buffer')
const SharedEditor = require('./shared-editor')
const HOST_SITE_ID = 1

module.exports =
class HostPortal {
  constructor ({restGateway, pubSubGateway, heartbeatIntervalInMilliseconds}) {
    this.id = null
    this.siteId = HOST_SITE_ID
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.activeSharedEditor = null
    this.heartbeatIntervalInMilliseconds = heartbeatIntervalInMilliseconds
    this.heartbeat = null
  }

  async create () {
    const {id} = await this.restGateway.post('/portals')
    this.id = id
    await this.subscribe()

    this.heartbeat = new Heartbeat({
      restGateway: this.restGateway,
      portalId: this.id,
      siteId: this.siteId,
      intervalInMilliseconds: this.heartbeatIntervalInMilliseconds
    })
    this.heartbeat.start()
  }

  async createSharedEditor ({sharedBuffer, selectionRanges}) {
    const sharedEditor = new SharedEditor({
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
      siteId: this.siteId
    })
    await sharedEditor.create({sharedBuffer, selectionRanges})
    return sharedEditor
  }

  async createSharedBuffer ({uri, text}) {
    const sharedBuffer = new SharedBuffer({
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
      siteId: this.siteId
    })
    await sharedBuffer.create({uri, text})
    return sharedBuffer
  }

  async setActiveSharedEditor (sharedEditor) {
    this.activeSharedEditor = sharedEditor
    const sharedEditorId = sharedEditor ? sharedEditor.id : null
    await this.restGateway.put(`/portals/${this.id}`, {sharedEditorId})
  }

  async subscribe () {
    await this.pubSubGateway.subscribe(
      `/portals/${this.id}`,
      'disconnect-site',
      this.receiveDisconnectSite.bind(this)
    )
  }

  receiveDisconnectSite (message) {
    const {siteId} = JSON.parse(message.text)
    if (this.activeSharedEditor) this.activeSharedEditor.siteDidDisconnect(siteId)
  }

  dispose () {
    if (this.heartbeat) this.heartbeat.stop()
  }
}
