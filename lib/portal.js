const assert = require('assert')
const {CompositeDisposable} = require('event-kit')
const Router = require('./router')
const BufferProxy = require('./buffer-proxy')
const EditorProxy = require('./editor-proxy')
const StarOverlayNetwork = require('./star-overlay-network')
const Messages = require('./teletype-client_pb')
const NullPortalDelegate = require('./null-portal-delegate')

module.exports =
class Portal {
  constructor ({id, hostPeerId, siteId, peerPool, connectionTimeout, tetherDisconnectWindow}) {
    this.id = id
    this.hostPeerId = hostPeerId
    this.siteId = siteId
    this.tetherDisconnectWindow = tetherDisconnectWindow
    this.isHost = isHostSiteId(this.siteId)
    this.siteIdsByPeerId = new Map()
    this.peerIdsBySiteId = new Map()
    this.editorProxiesById = new Map()
    this.bufferProxiesById = new Map()
    this.activeEditorProxy = null
    this.disposables = new CompositeDisposable()
    this.disposed = false
    this.delegate = new NullPortalDelegate()

    this.peerPool = peerPool
    this.network = new StarOverlayNetwork({id, isHub: this.isHost, peerPool, connectionTimeout})
    this.router = new Router(this.network)

    if (this.isHost) {
      this.bindPeerIdToSiteId(this.network.getPeerId(), this.siteId)
      this.nextSiteId = 2
      this.nextBufferId = 1
      this.nextEditorId = 1
      this.disposables.add(
        this.router.onRequest(`/portals/${id}`, this.receiveSubscription.bind(this))
      )
    } else {
      this.disposables.add(
        this.router.onNotification(`/portals/${id}`, this.receiveUpdate.bind(this))
      )
    }

    this.disposables.add(this.network.onMemberLeave(this.siteDidLeave.bind(this)))
  }

  getLocalSiteId () {
    return this.siteId
  }

  dispose () {
    this.editorProxiesById.forEach((editorProxy) => {
      editorProxy.dispose()
    })

    this.bufferProxiesById.forEach((bufferProxy) => {
      bufferProxy.dispose()
    })

    this.disposables.dispose()
    this.router.dispose()
    this.network.dispose()

    this.delegate.dispose()
    this.disposed = true
  }

  setDelegate (delegate) {
    this.delegate = delegate || new NullPortalDelegate()
    if (!this.isHost) this.delegate.setActiveEditorProxy(this.activeEditorProxy)
  }

  async initialize () {
    try {
      this.disposables.add(await this.peerPool.listen())
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  async join () {
    try {
      await this.network.connectTo(this.hostPeerId)
    } catch (error) {
      this.dispose()
      throw error
    }
    const rawResponse = await this.router.request(this.hostPeerId, `/portals/${this.id}`)
    const response = Messages.PortalSubscriptionResponse.deserializeBinary(rawResponse.body)

    response.getSiteIdsByPeerIdMap().forEach((siteId, peerId) => {
      this.bindPeerIdToSiteId(peerId, siteId)
    })
    this.siteId = this.siteIdsByPeerId.get(this.network.getPeerId())

    const activeBufferProxyMessage = response.getActiveBufferProxy()
    if (activeBufferProxyMessage) {
      this.deserializeBufferProxy(activeBufferProxyMessage)
    }

    const activeEditorProxyMessage = response.getActiveEditorProxy()
    if (activeEditorProxyMessage) {
      this.activeEditorProxy = this.deserializeEditorProxy(activeEditorProxyMessage)
      this.activeEditorProxy.follow(1)
    }

    this.delegate.setActiveEditorProxy(this.activeEditorProxy)
  }

  createBufferProxy (props) {
    const id = this.nextBufferId++
    const bufferProxy = new BufferProxy(Object.assign({
      id,
      siteId: this.siteId,
      router: this.router,
      didDispose: () => this.bufferProxiesById.delete(id)
    }, props))
    this.bufferProxiesById.set(id, bufferProxy)
    return bufferProxy
  }

  deserializeBufferProxy (message) {
    const bufferProxy = BufferProxy.deserialize(message, {
      router: this.router,
      siteId: this.siteId,
      didDispose: () => this.bufferProxiesById.delete(bufferProxy.id)
    })
    this.bufferProxiesById.set(bufferProxy.id, bufferProxy)
    return bufferProxy
  }

  createEditorProxy (props) {
    const id = this.nextEditorId++
    const editorProxy = new EditorProxy(Object.assign({
      id,
      siteId: this.siteId,
      router: this.router,
      tetherDisconnectWindow: this.tetherDisconnectWindow,
      didDispose: () => this.editorProxiesById.delete(id)
    }, props))
    this.editorProxiesById.set(id, editorProxy)
    return editorProxy
  }

  deserializeEditorProxy (message) {
    const editorProxy = EditorProxy.deserialize(message, {
      router: this.router,
      siteId: this.siteId,
      bufferProxiesById: this.bufferProxiesById,
      tetherDisconnectWindow: this.tetherDisconnectWindow,
      didDispose: () => this.editorProxiesById.delete(editorProxy.id)
    })
    this.editorProxiesById.set(editorProxy.id, editorProxy)
    return editorProxy
  }

  setActiveEditorProxy (editorProxy) {
    assert(this.isHost, 'Only the host can set the active editor proxy')

    if (editorProxy != this.activeEditorProxy) {
      this.activeEditorProxy = editorProxy

      const editorProxySwitchMessage = new Messages.PortalUpdate.EditorProxySwitch()
      if (this.activeEditorProxy) {
        editorProxySwitchMessage.setBufferProxyId(this.activeEditorProxy.bufferProxy.id)
        editorProxySwitchMessage.setEditorProxyId(this.activeEditorProxy.id)
      }
      const updateMessage = new Messages.PortalUpdate()
      updateMessage.setEditorProxySwitch(editorProxySwitchMessage)

      this.router.notify(`/portals/${this.id}`, updateMessage.serializeBinary())
    }
  }

  getActiveSiteIds () {
    return this.network.getMemberIds().map((id) => this.siteIdsByPeerId.get(id))
  }

  getSiteIdentity (siteId) {
    const peerId = this.peerIdsBySiteId.get(siteId)
    return this.network.getMemberIdentity(peerId)
  }

  siteDidLeave ({peerId, connectionLost}) {
    const siteId = this.siteIdsByPeerId.get(peerId)

    this.editorProxiesById.forEach((editorProxy) => {
      if (isHostSiteId(siteId)) {
        editorProxy.hostDidDisconnect()
      } else {
        editorProxy.siteDidDisconnect(siteId)
      }
    })

    if (isHostSiteId(siteId)) {
      if (connectionLost) {
        this.delegate.hostDidLoseConnection()
      } else {
        this.delegate.hostDidClosePortal()
      }

      this.dispose()
    } else {
      this.delegate.siteDidLeave(siteId)
    }
  }

  receiveSubscription ({senderId, requestId}) {
    this.assignNewSiteId(senderId)
    this.sendSubscriptionResponse(requestId)
    this.delegate.siteDidJoin(this.siteIdsByPeerId.get(senderId))
  }

  assignNewSiteId (peerId) {
    const siteId = this.nextSiteId++
    this.bindPeerIdToSiteId(peerId, siteId)

    const siteAssignmentMessage = new Messages.PortalUpdate.SiteAssignment()
    siteAssignmentMessage.setPeerId(peerId)
    siteAssignmentMessage.setSiteId(siteId)
    const updateMessage = new Messages.PortalUpdate()
    updateMessage.setSiteAssignment(siteAssignmentMessage)

    this.router.notify(`/portals/${this.id}`, updateMessage.serializeBinary())
  }

  sendSubscriptionResponse (requestId) {
    const response = new Messages.PortalSubscriptionResponse()

    this.siteIdsByPeerId.forEach((siteId, peerId) => {
      response.getSiteIdsByPeerIdMap().set(peerId, siteId)
    })

    if (this.activeEditorProxy) {
      response.setActiveEditorProxy(this.activeEditorProxy.serialize())
      response.setActiveBufferProxy(this.activeEditorProxy.bufferProxy.serialize())
    }

    this.router.respond(requestId, {body: response.serializeBinary()})
  }

  async receiveUpdate ({message}) {
    const updateMessage = Messages.PortalUpdate.deserializeBinary(message)

    if (updateMessage.hasEditorProxySwitch()) {
      await this.receiveEditorProxySwitch(updateMessage.getEditorProxySwitch())
    } else if (updateMessage.hasSiteAssignment()) {
      this.receiveSiteAssignment(updateMessage.getSiteAssignment())
    } else {
      throw new Error('Received unknown update message')
    }
  }

  async receiveEditorProxySwitch (editorProxySwitch) {
    const bufferProxyId = editorProxySwitch.getBufferProxyId()
    if (bufferProxyId && !this.bufferProxiesById.has(bufferProxyId)) {
      const response = await this.router.request(this.hostPeerId, `/buffers/${bufferProxyId}`)
      if (!response.ok) return

      const bufferProxyMessage = Messages.BufferProxy.deserializeBinary(response.body)
      this.deserializeBufferProxy(bufferProxyMessage)
    }

    const editorProxyId = editorProxySwitch.getEditorProxyId()
    let editorProxy = this.editorProxiesById.get(editorProxyId)
    if (editorProxyId && !this.editorProxiesById.has(editorProxyId)) {
      const response = await this.router.request(this.hostPeerId, `/editors/${editorProxyId}`)
      if (!response.ok) return

      const editorProxyMessage = Messages.EditorProxy.deserializeBinary(response.body)
      editorProxy = this.deserializeEditorProxy(editorProxyMessage)
    }

    if (editorProxy != this.activeEditorProxy) {
      this.activeEditorProxy = editorProxy
      this.delegate.setActiveEditorProxy(this.activeEditorProxy)
      if (this.activeEditorProxy) this.activeEditorProxy.follow(1)
    }
  }

  receiveSiteAssignment (siteAssignment) {
    const siteId = siteAssignment.getSiteId()
    const peerId = siteAssignment.getPeerId()
    this.bindPeerIdToSiteId(peerId, siteId)
    if (this.network.getPeerId() !== peerId) {
      this.delegate.siteDidJoin(siteId)
    }
  }

  bindPeerIdToSiteId (peerId, siteId) {
    this.siteIdsByPeerId.set(peerId, siteId)
    this.peerIdsBySiteId.set(siteId, peerId)
  }
}

function isHostSiteId (siteId) {
  return siteId === 1
}
