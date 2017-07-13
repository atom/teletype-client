const Router = require('./router')
const StarOverlayNetwork = require('./star-overlay-network')
const {PortalSubscriptionResponse} = require('./real-time_pb')

module.exports =
class Portal {
  constructor ({id, hostPeerId, siteId, peerPool}) {
    this.id = id
    this.hostPeerId = hostPeerId
    this.siteId = siteId
    this.isHost = this.siteId === 1

    this.network = new StarOverlayNetwork({id, isHub: this.isHost, peerPool})
    this.router = new Router(this.network)

    if (this.isHost) {
      this.nextSiteId = 2
      this.router.onRequest(`/portals/${id}`, this.receiveSubscription.bind(this))
    }
  }

  async join (hostPeerId) {
    await this.network.connectTo(hostPeerId)
    const response = PortalSubscriptionResponse.deserializeBinary(
      await this.router.request(hostPeerId, `/portals/${this.id}`)
    )
    this.siteId = response.getSiteId()
    console.log('subscribed', this.siteId);
  }

  dispose () {
    this.router.dispose()
    this.network.dispose()
  }

  setDelegate (delegate) {
    this.delegate = delegate
  }

  receiveSubscription ({requestId}) {
    const response = new PortalSubscriptionResponse()
    response.setSiteId(this.nextSiteId++)
    this.router.respond(requestId, response.serializeBinary())
  }
}

class HostPortal {
  constructor ({restGateway, pubSubGateway, heartbeatIntervalInMilliseconds}) {
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.taskQueue = new TaskQueue()
    this.heartbeatIntervalInMilliseconds = heartbeatIntervalInMilliseconds
    this.heartbeat = null
    this.id = null
    this.siteId = HOST_SITE_ID
    this.activeSharedEditor = null
    this.subscriptions = []
    this.disposed = false
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
      siteId: this.siteId,
      taskQueue: this.taskQueue
    })
    await sharedEditor.create({sharedBuffer, selectionRanges})
    return sharedEditor
  }

  async createSharedBuffer ({uri, text}) {
    const sharedBuffer = new SharedBuffer({
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
      siteId: this.siteId,
      taskQueue: this.taskQueue
    })
    await sharedBuffer.create({uri, text})
    return sharedBuffer
  }

  setActiveSharedEditor (sharedEditor) {
    this.activeSharedEditor = sharedEditor

    const sharedEditorId = sharedEditor ? sharedEditor.id : null
    const id = `/portals/${this.id}`
    this.taskQueue.cancelPending(id)
    this.taskQueue.push({
      id,
      data: sharedEditorId,
      coalesce: this.coalesceActiveEditorIds,
      execute: this.sendActiveSharedEditorId.bind(this)
    })
  }

  // Private
  coalesceActiveEditorIds (activeEditorIds) {
    return activeEditorIds[activeEditorIds.length - 1]
  }

  // Private
  sendActiveSharedEditorId (sharedEditorId) {
    return this.restGateway.put(`/portals/${this.id}`, {sharedEditorId})
  }

  async subscribe () {
    this.subscriptions.push(await this.subscribeToSiteDisconnectEvents())
  }

  subscribeToSiteDisconnectEvents () {
    return this.pubSubGateway.subscribe(
      `/portals/${this.id}`,
      'disconnect-site',
      this.receiveDisconnectSite.bind(this)
    )
  }

  receiveDisconnectSite (message) {
    let {siteId} = JSON.parse(message.text)
    siteId = parseInt(siteId)

    if (this.activeSharedEditor) this.activeSharedEditor.siteDidDisconnect(siteId)
  }

  async dispose () {
    if (!this.disposed) {
      this.disposed = true

      if (this.heartbeat) await this.heartbeat.dispose()

      if (this.taskQueue) this.taskQueue.dispose()

      for (let i = 0; i < this.subscriptions.length; i++) {
        this.subscriptions[i].dispose()
      }
      this.subscriptions.length = 0
    }
  }

  simulateNetworkFailure () {
    return this.heartbeat.dispose()
  }
}

class GuestPortal {
  constructor ({id, restGateway, pubSubGateway, heartbeatIntervalInMilliseconds}) {
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.taskQueue = new TaskQueue()
    this.heartbeatIntervalInMilliseconds = heartbeatIntervalInMilliseconds
    this.heartbeat = null
    this.id = id
    this.siteId = null
    this.activeSharedEditor = null
    this.subscriptions = []
    this.disposed = false
  }

  setDelegate (delegate) {
    this.delegate = delegate
    this.delegate.setActiveSharedEditor(this.activeSharedEditor)
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
      pubSubGateway: this.pubSubGateway,
      taskQueue: this.taskQueue
    })
    await sharedEditor.join()
    return sharedEditor
  }

  async subscribe () {
    this.subscriptions.push(
      await this.subscribeToUpdateEvents(),
      await this.subscribeToSiteDisconnectEvents()
    )
  }

  subscribeToUpdateEvents () {
    return this.pubSubGateway.subscribe(
      `/portals/${this.id}`,
      'update',
      this.receiveUpdate.bind(this)
    )
  }

  subscribeToSiteDisconnectEvents () {
    return this.pubSubGateway.subscribe(
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
    siteId = parseInt(siteId)

    if (siteId === HOST_SITE_ID) {
      if (this.activeSharedEditor) this.activeSharedEditor.hostDidDisconnect()
      this.delegate.hostDidDisconnect()
      this.dispose()
    } else {
      if (this.activeSharedEditor) this.activeSharedEditor.siteDidDisconnect(siteId)
    }
  }

  async dispose () {
    if (!this.disposed) {
      this.disposed = true

      if (this.heartbeat) await this.heartbeat.dispose()

      if (this.taskQueue) this.taskQueue.dispose()

      for (let i = 0; i < this.subscriptions.length; i++) {
        this.subscriptions[i].dispose()
      }
      this.subscriptions.length = 0
    }
  }

  simulateNetworkFailure () {
    return this.heartbeat.dispose()
  }
}
