const Heartbeat = require('./heartbeat')
const SharedEditor = require('./shared-editor')
const SharedBuffer = require('./shared-buffer')
const HOST_SITE_ID = 1

class Portal {
  constructor ({restGateway, pubSubGateway, heartbeatIntervalInMilliseconds}) {
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.heartbeatIntervalInMilliseconds = heartbeatIntervalInMilliseconds
    this.heartbeat = null
    this.id = null
    this.siteId = null
    this.activeSharedEditor = null
  }

  async subscribeToSiteDisconnectEvents () {
    await this.pubSubGateway.subscribe(
      `/portals/${this.id}`,
      'disconnect-site',
      this.receiveDisconnectSite.bind(this)
    )
  }

  dispose () {
    if (this.heartbeat) this.heartbeat.stop()
  }
}

class HostPortal extends Portal {
  constructor ({restGateway, pubSubGateway, heartbeatIntervalInMilliseconds}) {
    super({restGateway, pubSubGateway, heartbeatIntervalInMilliseconds})
    this.siteId = HOST_SITE_ID
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
    await this.subscribeToSiteDisconnectEvents()
  }

  receiveDisconnectSite (message) {
    const {siteId} = JSON.parse(message.text)
    if (this.activeSharedEditor) this.activeSharedEditor.siteDidDisconnect(siteId)
  }
}

class GuestPortal extends Portal {
  constructor ({id, restGateway, pubSubGateway, heartbeatIntervalInMilliseconds}) {
    super({restGateway, pubSubGateway, heartbeatIntervalInMilliseconds})
    this.id = id
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
    await this.subscribeToUpdateEvents()
    await this.subscribeToSiteDisconnectEvents()
  }

  async subscribeToUpdateEvents () {
    await this.pubSubGateway.subscribe(
      `/portals/${this.id}`,
      'update',
      this.receiveUpdate.bind(this)
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
}

module.exports = {GuestPortal, HostPortal}
