const assert = require('assert')
const {CompositeDisposable} = require('event-kit')
const Router = require('./router')
const BufferProxy = require('./buffer-proxy')
const EditorProxy = require('./editor-proxy')
const StarOverlayNetwork = require('./star-overlay-network')
const Messages = require('./real-time_pb')

module.exports =
class Portal {
  constructor ({id, hostPeerId, siteId, peerPool}) {
    this.id = id
    this.hostPeerId = hostPeerId
    this.siteId = siteId
    this.isHost = isHost(this.siteId)
    this.siteIdsByPeerId = new Map()
    this.editorProxiesById = new Map()
    this.bufferProxiesById = new Map()
    this.activeEditorProxy = null
    this.disposables = new CompositeDisposable()
    this.disposed = false

    this.peerPool = peerPool
    this.network = new StarOverlayNetwork({id, isHub: this.isHost, peerPool})
    this.router = new Router(this.network)

    if (this.isHost) {
      this.siteIdsByPeerId.set(this.network.getPeerId(), this.siteId)
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

    this.disposables.add(this.network.onPeerLeave(this.siteDidLeave.bind(this)))
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
    this.disposed = true
  }

  setDelegate (delegate) {
    this.delegate = delegate
    if (this.delegate) this.delegate.setActiveEditorProxy(this.activeEditorProxy)
  }

  async join () {
    await this.network.connectTo(this.hostPeerId)
    const rawResponse = await this.router.request(this.hostPeerId, `/portals/${this.id}`)
    const response = Messages.PortalSubscriptionResponse.deserializeBinary(rawResponse)

    response.getSiteIdsByPeerIdMap().forEach((siteId, peerId) => {
      this.siteIdsByPeerId.set(peerId, siteId)
    })
    this.siteId = this.siteIdsByPeerId.get(this.network.getPeerId())

    const activeBufferMessage = response.getActiveBufferProxy()
    if (activeBufferMessage) {
      const activeBuffer = BufferProxy.deserialize(activeBufferMessage, {
        router: this.router,
        siteId: this.siteId
      })
      this.bufferProxiesById.set(activeBuffer.id, activeBuffer)
    }

    const activeEditorMessage = response.getActiveEditorProxy()
    if (activeEditorMessage) {
      this.activeEditorProxy = await EditorProxy.deserialize(activeEditorMessage, {
        router: this.router,
        siteId: this.siteId,
        bufferProxiesById: this.bufferProxiesById
      })
      this.editorProxiesById.set(this.activeEditorProxy.id, this.activeEditorProxy)
    }

    if (this.delegate) this.delegate.setActiveEditorProxy(this.activeEditorProxy)
  }

  createBufferProxy (props) {
    const id = this.nextBufferId++
    const bufferProxy = new BufferProxy(Object.assign({
      id,
      siteId: this.siteId,
      router: this.router
    }, props))
    this.bufferProxiesById.set(id, bufferProxy)
    return bufferProxy
  }

  createEditorProxy (props) {
    const id = this.nextEditorId++
    const editorProxy = new EditorProxy(Object.assign({
      id,
      siteId: this.siteId,
      router: this.router
    }, props))
    this.editorProxiesById.set(id, editorProxy)
    return editorProxy
  }

  setActiveEditorProxy (editorProxy) {
    assert(this.isHost, 'Only the host can set the active editor proxy')
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

  simulateNetworkFailure () {
    this.peerPool.disconnect()
  }

  getDebugInfo () {
    return this.activeEditorProxy.bufferProxy.getDebugInfo()
  }

  siteDidLeave ({peerId, connectionLost}) {
    const siteId = this.siteIdsByPeerId.get(peerId)

    this.editorProxiesById.forEach((editorProxy) => {
      if (isHost(siteId)) {
        editorProxy.hostDidDisconnect()
      } else {
        editorProxy.siteDidDisconnect(siteId)
      }
    })

    if (isHost(siteId)) {
      if (connectionLost) {
        if (this.delegate) this.delegate.hostDidLoseConnection()
      } else {
        if (this.delegate) this.delegate.hostDidClosePortal()
      }

      this.dispose()
    }
  }

  receiveSubscription ({senderId, requestId}) {
    this.assignNewSiteId(senderId)
    this.sendSubscriptionResponse(requestId)
  }

  assignNewSiteId (peerId) {
    const siteId = this.nextSiteId++
    this.siteIdsByPeerId.set(peerId, siteId)

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

    this.router.respond(requestId, response.serializeBinary())
  }

  receiveUpdate ({message}) {
    const updateMessage = Messages.PortalUpdate.deserializeBinary(message)

    if (updateMessage.hasEditorProxySwitch()) {
      this.receiveEditorProxySwitch(updateMessage.getEditorProxySwitch())
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
      const bufferProxyMessage = Messages.BufferProxy.deserializeBinary(response)
      const bufferProxy = BufferProxy.deserialize(bufferProxyMessage, {
        router: this.router,
        siteId: this.siteId
      })
      this.bufferProxiesById.set(bufferProxyId, bufferProxy)
    }

    const editorProxyId = editorProxySwitch.getEditorProxyId()
    let editorProxy = this.editorProxiesById.get(editorProxyId)
    if (editorProxyId && !this.editorProxiesById.has(editorProxyId)) {
      const response = await this.router.request(this.hostPeerId, `/editors/${editorProxyId}`)
      const editorProxyMessage = Messages.EditorProxy.deserializeBinary(response)
      editorProxy = await EditorProxy.deserialize(editorProxyMessage, {
        router: this.router,
        siteId: this.siteId,
        bufferProxiesById: this.bufferProxiesById
      })
      this.editorProxiesById.set(editorProxyId, editorProxy)
    }

    this.activeEditorProxy = editorProxy
    if (this.delegate) this.delegate.setActiveEditorProxy(this.activeEditorProxy)
  }

  receiveSiteAssignment (siteAssignment) {
    this.siteIdsByPeerId.set(siteAssignment.getPeerId(), siteAssignment.getSiteId())
  }
}

function isHost (siteId) {
  return siteId === 1
}
