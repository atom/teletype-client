const assert = require('assert')
const {CompositeDisposable} = require('event-kit')
const Router = require('./router')
const BufferProxy = require('./buffer-proxy')
const EditorProxy = require('./editor-proxy')
const StarOverlayNetwork = require('./star-overlay-network')
const Messages = require('./teletype-client_pb')
const NullPortalDelegate = require('./null-portal-delegate')
const FollowState = require('./follow-state')

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
    this.activeEditorProxiesBySiteId = new Map()
    this.activeEditorProxySubscriptions = new CompositeDisposable()
    this.tethersByFollowerId = new Map()
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
    }

    this.disposables.add(
      this.router.onNotification(`/portals/${id}`, this.receiveUpdate.bind(this)),
      this.network.onMemberLeave(this.siteDidLeave.bind(this))
    )
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

  async setDelegate (delegate) {
    this.delegate = delegate || new NullPortalDelegate()

    if (!this.isHost) {
      this.editorProxiesById.forEach((editorProxy) => {
        this.delegate.addEditorProxy(editorProxy)
      })
    }

    await this.delegate.updateTether(
      this.resolveFollowState(),
      this.getLocalActiveEditorProxy(),
      this.resolveLeaderPosition()
    )
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
    const rawResponse = await this.router.request({recipientId: this.hostPeerId, channelId: `/portals/${this.id}`})
    const response = Messages.PortalSubscriptionResponse.deserializeBinary(rawResponse.body)

    response.getSiteIdsByPeerIdMap().forEach((siteId, peerId) => {
      this.bindPeerIdToSiteId(peerId, siteId)
    })
    this.siteId = this.siteIdsByPeerId.get(this.network.getPeerId())

    const tethers = response.getTethersList()
    for (let i = 0; i < tethers.length; i++) {
      const tether = tethers[i]
      this.tethersByFollowerId.set(tether.getFollowerSiteId(), {
        leaderId: tether.getLeaderSiteId(),
        state: tether.getState()
      })
    }

    const activeBufferProxies = response.getActiveBufferProxiesList()
    for (let i = 0; i < activeBufferProxies.length; i++) {
      const bufferProxyMessage = activeBufferProxies[i]
      this.deserializeBufferProxy(bufferProxyMessage)
    }

    const activeEditorProxies = response.getActiveEditorProxiesList()
    for (let i = 0; i < activeEditorProxies.length; i++) {
      const editorProxyMessage = activeEditorProxies[i]
      const editorProxy = this.deserializeEditorProxy(editorProxyMessage)
      this.delegate.addEditorProxy(editorProxy)
    }

    response.getActiveEditorProxyIdsBySiteIdMap().forEach((editorProxyId, siteId) => {
      const editorProxy = this.editorProxiesById.get(editorProxyId)
      this.activeEditorProxiesBySiteId.set(siteId, editorProxy)
    })

    this.follow(1)
  }

  createBufferProxy (props) {
    const id = this.nextBufferId++
    const bufferProxy = new BufferProxy(Object.assign({
      id,
      hostPeerId: this.hostPeerId,
      siteId: this.siteId,
      router: this.router,
      didDispose: () => this.bufferProxiesById.delete(id)
    }, props))
    this.bufferProxiesById.set(id, bufferProxy)
    return bufferProxy
  }

  async findBufferProxy (id) {
    if (id == null) return

    let bufferProxy = this.bufferProxiesById.get(id)
    if (!bufferProxy && !this.isHost) {
      bufferProxy = await this.requestBufferProxy(id)
    }

    return bufferProxy
  }

  async requestBufferProxy (id) {
    const response = await this.router.request({recipientId: this.hostPeerId, channelId: `/buffers/${id}`})
    if (response.ok) {
      const bufferProxyMessage = Messages.BufferProxy.deserializeBinary(response.body)
      return this.deserializeBufferProxy(bufferProxyMessage)
    }
  }

  deserializeBufferProxy (message) {
    const bufferProxy = BufferProxy.deserialize(message, {
      router: this.router,
      hostPeerId: this.hostPeerId,
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
      didDispose: () => this.editorProxiesById.delete(id),
      portal: this
    }, props))
    this.editorProxiesById.set(id, editorProxy)
    return editorProxy
  }

  async findEditorProxy (id) {
    let editorProxy = this.editorProxiesById.get(id)
    if (!editorProxy && !this.isHost) {
      editorProxy = await this.requestEditorProxy(id)
    }

    return editorProxy
  }

  async requestEditorProxy (id) {
    if (id == null) return

    const response = await this.router.request({recipientId: this.hostPeerId, channelId: `/editors/${id}`})
    if (response.ok) {
      const editorProxyMessage = Messages.EditorProxy.deserializeBinary(response.body)
      const editorProxy = this.deserializeEditorProxy(editorProxyMessage)
      this.delegate.addEditorProxy(editorProxy)
      editorProxy.hideSelections()
      return editorProxy
    }
  }

  deserializeEditorProxy (message) {
    const editorProxy = EditorProxy.deserialize(message, {
      router: this.router,
      siteId: this.siteId,
      bufferProxiesById: this.bufferProxiesById,
      didDispose: () => this.editorProxiesById.delete(editorProxy.id),
      portal: this
    })
    this.editorProxiesById.set(editorProxy.id, editorProxy)
    return editorProxy
  }

  activateEditorProxy (newEditorProxy) {
    const oldEditorProxy = this.getLocalActiveEditorProxy()
    if (newEditorProxy != oldEditorProxy) {
      this.unfollow()
      if (oldEditorProxy) oldEditorProxy.hideSelections()
      if (newEditorProxy) newEditorProxy.showSelections()

      this.activeEditorProxiesBySiteId.set(this.siteId, newEditorProxy)
      this.subscribeToEditorProxyChanges(newEditorProxy)
      this.broadcastEditorProxySwitch(newEditorProxy)

      this.updateActivePositions()
    }
  }

  getLocalActiveEditorProxy () {
    return this.activeEditorProxyForSiteId(this.siteId)
  }

  activeEditorProxyForSiteId (siteId) {
    const leaderId = this.resolveLeaderSiteId(siteId)
    const followState = this.resolveFollowState(siteId)
    if (followState === FollowState.RETRACTED) {
      return this.activeEditorProxiesBySiteId.get(leaderId)
    } else {
      return this.activeEditorProxiesBySiteId.get(siteId)
    }
  }

  removeEditorProxy (editorProxy) {
    assert(this.isHost, 'Only the host can remove editor proxies')

    const editorProxyRemovalMessage = new Messages.PortalUpdate.EditorProxyRemoval()
    editorProxyRemovalMessage.setEditorProxyId(editorProxy.id)
    const updateMessage = new Messages.PortalUpdate()
    updateMessage.setEditorProxyRemoval(editorProxyRemovalMessage)

    this.router.notify({channelId: `/portals/${this.id}`, body: updateMessage.serializeBinary()})
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

    const tether = this.tethersByFollowerId.get(this.siteId)
    if (tether && siteId === tether.leaderId) {
      this.unfollow()
    }
    this.tethersByFollowerId.delete(siteId)
    this.activeEditorProxiesBySiteId.delete(siteId)
    this.updateActivePositions()
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

    this.router.notify({channelId: `/portals/${this.id}`, body: updateMessage.serializeBinary()})
  }

  sendSubscriptionResponse (requestId) {
    const response = new Messages.PortalSubscriptionResponse()

    this.siteIdsByPeerId.forEach((siteId, peerId) => {
      response.getSiteIdsByPeerIdMap().set(peerId, siteId)
    })

    const activeBufferProxiesById = new Map()
    const activeEditorProxiesById = new Map()
    this.activeEditorProxiesBySiteId.forEach((editorProxy, siteId) => {
      if (editorProxy) {
        const {bufferProxy} = editorProxy
        if (!activeBufferProxiesById.has(bufferProxy.id)) {
          activeBufferProxiesById.set(bufferProxy.id, bufferProxy.serialize())
        }

        if (!activeEditorProxiesById.has(editorProxy.id)) {
          activeEditorProxiesById.set(editorProxy.id, editorProxy.serialize())
        }

        response.getActiveEditorProxyIdsBySiteIdMap().set(siteId, editorProxy.id)
      }
    })
    response.setActiveBufferProxiesList(Array.from(activeBufferProxiesById.values()))
    response.setActiveEditorProxiesList(Array.from(activeEditorProxiesById.values()))

    const tethers = []
    this.tethersByFollowerId.forEach((tether, followerId) => {
      const tetherMessage = new Messages.Tether()
      tetherMessage.setFollowerSiteId(followerId)
      tetherMessage.setLeaderSiteId(tether.leaderId)
      tetherMessage.setState(tether.state)
      tethers.push(tetherMessage)
    })
    response.setTethersList(tethers)

    this.router.respond({requestId, body: response.serializeBinary()})
  }

  async receiveUpdate ({senderId, body}) {
    const updateMessage = Messages.PortalUpdate.deserializeBinary(body)

    if (updateMessage.hasEditorProxySwitch()) {
      const senderSiteId = this.siteIdsByPeerId.get(senderId)
      await this.receiveEditorProxySwitch(senderSiteId, updateMessage.getEditorProxySwitch())
    } else if (updateMessage.hasEditorProxyRemoval()) {
      this.receiveEditorProxyRemoval(updateMessage.getEditorProxyRemoval())
    } else if (updateMessage.hasSiteAssignment()) {
      this.receiveSiteAssignment(updateMessage.getSiteAssignment())
    } else if (updateMessage.hasTetherUpdate()) {
      this.receiveTetherUpdate(updateMessage.getTetherUpdate())
    } else {
      throw new Error('Received unknown update message')
    }
  }

  async receiveEditorProxySwitch (senderSiteId, editorProxySwitch) {
    const bufferProxyId = editorProxySwitch.getBufferProxyId()
    const editorProxyId = editorProxySwitch.getEditorProxyId()

    const bufferProxy = await this.findBufferProxy(bufferProxyId)
    const editorProxy = bufferProxy ? await this.findEditorProxy(editorProxyId) : null
    this.activeEditorProxiesBySiteId.set(senderSiteId, editorProxy)

    if (senderSiteId === this.resolveLeaderSiteId()) this.leaderDidUpdate()
    this.updateActivePositions()
  }

  receiveEditorProxyRemoval (editorProxyRemoval) {
    const editorProxyId = editorProxyRemoval.getEditorProxyId()
    const editorProxy = this.editorProxiesById.get(editorProxyId)
    if (editorProxy) this.delegate.removeEditorProxy(editorProxy)
  }

  receiveSiteAssignment (siteAssignment) {
    const siteId = siteAssignment.getSiteId()
    const peerId = siteAssignment.getPeerId()
    this.bindPeerIdToSiteId(peerId, siteId)
    if (this.network.getPeerId() !== peerId) {
      this.delegate.siteDidJoin(siteId)
    }
  }

  receiveTetherUpdate (tetherUpdate) {
    const oldResolvedLeaderId = this.resolveLeaderSiteId()
    const oldResolvedState = this.resolveFollowState()

    const followerSiteId = tetherUpdate.getFollowerSiteId()
    const leaderSiteId = tetherUpdate.getLeaderSiteId()
    const tetherState = tetherUpdate.getState()
    this.tethersByFollowerId.set(followerSiteId, {leaderId: leaderSiteId, state: tetherState})

    const newResolvedLeaderId = this.resolveLeaderSiteId()
    const newResolvedState = this.resolveFollowState()
    this.didChangeTetherState({oldResolvedState, oldResolvedLeaderId, newResolvedState, newResolvedLeaderId})
  }

  bindPeerIdToSiteId (peerId, siteId) {
    this.siteIdsByPeerId.set(peerId, siteId)
    this.peerIdsBySiteId.set(siteId, peerId)
  }

  subscribeToEditorProxyChanges (editorProxy) {
    this.activeEditorProxySubscriptions.dispose()
    this.activeEditorProxySubscriptions = new CompositeDisposable()
    if (editorProxy) {
      this.activeEditorProxySubscriptions.add(editorProxy.onDidScroll(this.activeEditorDidScroll.bind(this)))
      this.activeEditorProxySubscriptions.add(editorProxy.onDidUpdateLocalSelections(this.activeEditorDidUpdateLocalSelections.bind(this)))
      this.activeEditorProxySubscriptions.add(editorProxy.onDidUpdateRemoteSelections(this.activeEditorDidUpdateRemoteSelections.bind(this)))
      this.activeEditorProxySubscriptions.add(editorProxy.bufferProxy.onDidUpdateText(this.activeEditorDidUpdateText.bind(this)))
    }
  }

  activeEditorDidUpdateLocalSelections ({initialUpdate}) {
    this.lastLocalUpdateAt = Date.now()
    if (!initialUpdate && this.resolveFollowState() === FollowState.RETRACTED) {
      const localCursorPosition = this.getLocalActiveEditorProxy().cursorPositionForSiteId(this.siteId)
      const leaderPosition = this.resolveLeaderPosition()
      if (localCursorPosition && leaderPosition && !pointsEqual(localCursorPosition, leaderPosition)) {
        this.extendTether()
      }
    }

    this.updateActivePositions()
  }

  activeEditorDidUpdateRemoteSelections ({selectionLayerIdsBySiteId, initialUpdate}) {
    const leaderDidChangeSelections = selectionLayerIdsBySiteId.has(this.resolveLeaderSiteId())
    if (!initialUpdate && leaderDidChangeSelections) {
      this.leaderDidUpdate()
    }

    this.updateActivePositions()
  }

  activeEditorDidUpdateText ({remote}) {
    if (this.resolveFollowState() === FollowState.RETRACTED) {
      if (remote) {
        this.delegate.updateTether(FollowState.RETRACTED, this.getLocalActiveEditorProxy(), this.resolveLeaderPosition())
      } else {
        this.lastLocalUpdateAt = Date.now()
        this.extendTether()
      }
    }

    this.updateActivePositions()
  }

  activeEditorDidScroll () {
    const leaderPosition = this.resolveLeaderPosition()
    if (leaderPosition && this.getLocalActiveEditorProxy().isScrollNeededToViewPosition(leaderPosition)) {
      this.unfollow()
    }
  }

  follow (leaderSiteId) {
    this.setFollowState(FollowState.RETRACTED, leaderSiteId)
  }

  unfollow () {
    this.setFollowState(FollowState.DISCONNECTED)
  }

  extendTether () {
    this.setFollowState(FollowState.EXTENDED)
  }

  retractTether () {
    this.setFollowState(FollowState.RETRACTED)
  }

  getFollowedSiteId () {
    if (this.resolveFollowState() === FollowState.DISCONNECTED) {
      return null
    } else {
      return this.tethersByFollowerId.get(this.siteId).leaderId
    }
  }

  // Private
  leaderDidUpdate () {
    switch (this.resolveFollowState()) {
      case FollowState.RETRACTED:
        const editorProxy = this.getLocalActiveEditorProxy()
        this.subscribeToEditorProxyChanges(editorProxy)
        this.delegate.updateTether(FollowState.RETRACTED, editorProxy, this.resolveLeaderPosition())
        break
      case FollowState.EXTENDED:
        this.retractOrDisconnectTether()
        break
    }
  }

  // Private
  retractOrDisconnectTether () {
    const leaderPosition = this.resolveLeaderPosition()
    const leaderSiteId = this.resolveLeaderSiteId()
    const localActiveEditorProxy = this.getLocalActiveEditorProxy()
    const leaderActiveEditorProxy = this.activeEditorProxyForSiteId(leaderSiteId)
    const leaderPositionIsInvisible = (
      localActiveEditorProxy !== leaderActiveEditorProxy ||
      (leaderPosition && localActiveEditorProxy.isScrollNeededToViewPosition(leaderPosition))
    )

    const hasRecentlyPerformedLocalUpdate = (Date.now() - this.lastLocalUpdateAt) <= this.tetherDisconnectWindow
    if (leaderPositionIsInvisible) {
      if (hasRecentlyPerformedLocalUpdate) {
        this.unfollow()
      } else {
        this.retractTether()
      }
    }
  }

  // Private
  setFollowState (newState, newLeaderId) {
    const tether = this.tethersByFollowerId.get(this.siteId)
    const oldState = tether ? tether.state : null
    const oldResolvedState = this.resolveFollowState()
    const oldResolvedLeaderId = this.resolveLeaderSiteId()
    const oldLeaderId = tether ? tether.leaderId : null
    newLeaderId = newLeaderId == null ? oldLeaderId : newLeaderId
    if (newLeaderId == null) return

    this.tethersByFollowerId.set(this.siteId, {leaderId: newLeaderId, state: newState})

    const newResolvedState = this.resolveFollowState()
    const newResolvedLeaderId = this.resolveLeaderSiteId()
    this.didChangeTetherState({oldResolvedState, oldResolvedLeaderId, newResolvedState, newResolvedLeaderId})

    if (oldState !== newState || oldLeaderId !== newLeaderId) {
      const tetherMessage = new Messages.Tether()
      tetherMessage.setFollowerSiteId(this.siteId)
      tetherMessage.setLeaderSiteId(newLeaderId)
      tetherMessage.setState(newState)
      const updateMessage = new Messages.PortalUpdate()
      updateMessage.setTetherUpdate(tetherMessage)

      this.router.notify({channelId: `/portals/${this.id}`, body: updateMessage.serializeBinary()})
    }
  }

  didChangeTetherState ({oldResolvedState, oldResolvedLeaderId, newResolvedState, newResolvedLeaderId}) {
    const oldLeaderActiveEditorProxy = this.activeEditorProxiesBySiteId.get(oldResolvedLeaderId)
    const newLeaderActiveEditorProxy = this.activeEditorProxiesBySiteId.get(newResolvedLeaderId)

    if (newResolvedState === FollowState.RETRACTED) {
      this.editorProxiesById.forEach((editorProxy) => {
        editorProxy.hideSelections()
      })

      this.subscribeToEditorProxyChanges(newLeaderActiveEditorProxy)
    } else if (oldResolvedState === FollowState.RETRACTED) {
      this.activeEditorProxiesBySiteId.set(this.siteId, oldLeaderActiveEditorProxy)
      this.broadcastEditorProxySwitch(oldLeaderActiveEditorProxy)
      if (oldLeaderActiveEditorProxy) oldLeaderActiveEditorProxy.showSelections()
    }

    this.delegate.updateTether(newResolvedState, this.getLocalActiveEditorProxy(), this.resolveLeaderPosition())
    this.updateActivePositions()
  }

  updateActivePositions () {
    const activePositions = {}
    const activeSiteIds = this.getActiveSiteIds()
    for (let i = 0; i < activeSiteIds.length; i++) {
      const siteId = activeSiteIds[i]
      const editorProxy = this.activeEditorProxyForSiteId(siteId)
      if (editorProxy) {
        let position
        if (this.resolveFollowState(siteId) === FollowState.RETRACTED) {
          const leaderId = this.resolveLeaderSiteId(siteId)
          position = editorProxy.cursorPositionForSiteId(leaderId)
        } else {
          position = editorProxy.cursorPositionForSiteId(siteId)
        }

        activePositions[siteId] = {editorProxy, position}
      }
    }

    this.delegate.updateActivePositions(activePositions)
  }

  broadcastEditorProxySwitch (editorProxy) {
    const editorProxySwitchMessage = new Messages.PortalUpdate.EditorProxySwitch()
    if (editorProxy) {
      editorProxySwitchMessage.setBufferProxyId(editorProxy.bufferProxy.id)
      editorProxySwitchMessage.setEditorProxyId(editorProxy.id)
    }
    const updateMessage = new Messages.PortalUpdate()
    updateMessage.setEditorProxySwitch(editorProxySwitchMessage)
    this.router.notify({channelId: `/portals/${this.id}`, body: updateMessage.serializeBinary()})
  }

  resolveLeaderPosition (followerId = this.siteId) {
    const leaderId = this.resolveLeaderSiteId(followerId)
    const editorProxy = this.getLocalActiveEditorProxy()
    return editorProxy ? editorProxy.cursorPositionForSiteId(leaderId) : null
  }

  resolveFollowState (followerId = this.siteId) {
    const leaderId = this.resolveLeaderSiteId(followerId)
    if (followerId === leaderId) {
      return FollowState.DISCONNECTED
    } else {
      return this.tethersByFollowerId.get(followerId).state
    }
  }

  resolveLeaderSiteId (followerId = this.siteId) {
    const tether = this.tethersByFollowerId.get(followerId)
    if (!tether) return followerId

    const visitedSiteIds = new Set([followerId])
    let leaderId = tether.leaderId

    let nextTether = this.tethersByFollowerId.get(leaderId)
    while (nextTether && nextTether.state === FollowState.RETRACTED) {
      if (visitedSiteIds.has(leaderId)) {
        leaderId = Math.min(...Array.from(visitedSiteIds))
        break
      } else {
        visitedSiteIds.add(leaderId)
        leaderId = nextTether.leaderId
        nextTether = this.tethersByFollowerId.get(leaderId)
      }
    }

    return leaderId
  }
}

function isHostSiteId (siteId) {
  return siteId === 1
}

function pointsEqual (a, b) {
  return a.row === b.row && a.column === b.column
}
