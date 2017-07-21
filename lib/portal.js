const assert = require('assert')
const {CompositeDisposable} = require('event-kit')
const Router = require('./router')
const TextBuffer = require('./text-buffer')
const TextEditor = require('./text-editor')
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
    this.textEditorsById = new Map()
    this.textBuffersById = new Map()
    this.activeTextEditor = null
    this.disposables = new CompositeDisposable()

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
    this.disposables.dispose()
    this.router.dispose()
    this.network.dispose()
  }

  setDelegate (delegate) {
    this.delegate = delegate
    if (this.delegate) {
      this.delegate.setActiveTextEditor(this.activeTextEditor)
    }
  }

  async join () {
    await this.network.connectTo(this.hostPeerId)
    const rawResponse = await this.router.request(this.hostPeerId, `/portals/${this.id}`)
    const response = Messages.PortalSubscriptionResponse.deserializeBinary(rawResponse)

    response.getSiteIdsByPeerIdMap().forEach((siteId, peerId) => {
      this.siteIdsByPeerId.set(peerId, siteId)
    })
    this.siteId = this.siteIdsByPeerId.get(this.network.getPeerId())

    const activeBufferMessage = response.getActiveTextBuffer()
    if (activeBufferMessage) {
      const activeBuffer = TextBuffer.deserialize(activeBufferMessage, {
        router: this.router,
        siteId: this.siteId
      })
      this.textBuffersById.set(activeBuffer.id, activeBuffer)
    }

    const activeEditorMessage = response.getActiveTextEditor()
    if (activeEditorMessage) {
      this.activeTextEditor = await TextEditor.deserialize(activeEditorMessage, {
        router: this.router,
        siteId: this.siteId,
        textBuffersById: this.textBuffersById
      })
      this.textEditorsById.set(this.activeTextEditor.id, this.activeTextEditor)
    }

    if (this.delegate) this.delegate.setActiveTextEditor(this.activeTextEditor)
  }

  createTextBuffer (props) {
    const id = this.nextBufferId++
    const textBuffer = new TextBuffer(Object.assign({
      id,
      siteId: this.siteId,
      router: this.router
    }, props))
    this.textBuffersById.set(id, textBuffer)
    return textBuffer
  }

  createTextEditor (props) {
    const id = this.nextEditorId++
    const textEditor = new TextEditor(Object.assign({
      id,
      siteId: this.siteId,
      router: this.router
    }, props))
    this.textEditorsById.set(id, textEditor)
    return textEditor
  }

  setActiveTextEditor (textEditor) {
    assert(this.isHost, 'Only the host can set the active text editor')
    this.activeTextEditor = textEditor

    const textEditorSwitchMessage = new Messages.PortalUpdate.TextEditorSwitch()
    if (this.activeTextEditor) {
      textEditorSwitchMessage.setTextBufferId(this.activeTextEditor.textBuffer.id)
      textEditorSwitchMessage.setTextEditorId(this.activeTextEditor.id)
    }
    const updateMessage = new Messages.PortalUpdate()
    updateMessage.setTextEditorSwitch(textEditorSwitchMessage)

    this.router.notify(`/portals/${this.id}`, updateMessage.serializeBinary())
  }

  siteDidLeave ({peerId}) {
    const siteId = this.siteIdsByPeerId.get(peerId)

    this.textEditorsById.forEach((textEditor) => {
      if (isHost(siteId)) {
        textEditor.hostDidDisconnect()
      } else {
        textEditor.siteDidDisconnect(siteId)
      }
    })

    if (isHost(siteId)) {
      this.delegate.hostDidClosePortal()
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

    if (this.activeTextEditor) {
      response.setActiveTextEditor(this.activeTextEditor.serialize())
      response.setActiveTextBuffer(this.activeTextEditor.textBuffer.serialize())
    }

    this.router.respond(requestId, response.serializeBinary())
  }

  receiveUpdate ({message}) {
    const updateMessage = Messages.PortalUpdate.deserializeBinary(message)

    if (updateMessage.hasTextEditorSwitch()) {
      this.receiveTextEditorSwitch(updateMessage.getTextEditorSwitch())
    } else if (updateMessage.hasSiteAssignment()) {
      this.receiveSiteAssignment(updateMessage.getSiteAssignment())
    } else {
      throw new Error('Received unknown update message')
    }
  }

  async receiveTextEditorSwitch (textEditorSwitch) {
    const textBufferId = textEditorSwitch.getTextBufferId()
    if (textBufferId && !this.textBuffersById.has(textBufferId)) {
      const response = await this.router.request(this.hostPeerId, `/buffers/${textBufferId}`)
      const textBufferMessage = Messages.TextBuffer.deserializeBinary(response)
      const textBuffer = TextBuffer.deserialize(textBufferMessage, {
        router: this.router,
        siteId: this.siteId
      })
      this.textBuffersById.set(textBufferId, textBuffer)
    }

    const textEditorId = textEditorSwitch.getTextEditorId()
    let textEditor = this.textEditorsById.get(textEditorId)
    if (textEditorId && !this.textEditorsById.has(textEditorId)) {
      const response = await this.router.request(this.hostPeerId, `/editors/${textEditorId}`)
      const textEditorMessage = Messages.TextEditor.deserializeBinary(response)
      textEditor = await TextEditor.deserialize(textEditorMessage, {
        router: this.router,
        siteId: this.siteId,
        textBuffersById: this.textBuffersById
      })
      this.textEditorsById.set(textEditorId, textEditor)
    }

    this.activeTextEditor = textEditor
    this.delegate.setActiveTextEditor(this.activeTextEditor)
  }

  receiveSiteAssignment (siteAssignment) {
    this.siteIdsByPeerId.set(siteAssignment.getPeerId(), siteAssignment.getSiteId())
  }
}

function isHost (siteId) {
  return siteId === 1
}
