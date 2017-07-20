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
    this.isHost = this.siteId === 1
    this.siteIdsByPeerId = new Map()
    this.textEditorsById = new Map()
    this.textBuffersById = new Map()
    this.activeTextEditor = null
    this.disposables = new CompositeDisposable()

    this.network = new StarOverlayNetwork({id, isHub: this.isHost, peerPool})
    this.router = new Router(this.network)

    if (this.isHost) {
      this.nextSiteId = 2
      this.nextBufferId = 1
      this.nextEditorId = 1
      this.disposables.add(
        this.router.onRequest(`/portals/${id}`, this.receiveSubscription.bind(this)),
        this.network.onPeerLeave(this.siteDidLeave.bind(this))
      )
    } else {
      this.disposables.add(
        this.router.onNotification(`/portals/${id}`, this.receiveUpdate.bind(this))
      )
    }
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
    const response = Messages.PortalSubscriptionResponse.deserializeBinary(
      await this.router.request(this.hostPeerId, `/portals/${this.id}`)
    )
    this.siteId = response.getSiteId()

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

  leave () {
    this.dispose()
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
      textEditor.siteDidDisconnect(siteId)
    })

    const portalUpdateMessage = new Messages.PortalUpdate()
    const siteDisconnectMessage = new Messages.PortalUpdate.SiteDisconnection()
    siteDisconnectMessage.setSiteId(siteId)
    portalUpdateMessage.setSiteDisconnection(siteDisconnectMessage)
    this.router.notify(`/portals/${this.id}`, portalUpdateMessage.serializeBinary())
  }

  receiveSubscription ({senderId, requestId}) {
    const response = new Messages.PortalSubscriptionResponse()
    const siteId = this.nextSiteId++
    response.setSiteId(siteId)
    if (this.activeTextEditor) {
      response.setActiveTextEditor(this.activeTextEditor.serialize())
      response.setActiveTextBuffer(this.activeTextEditor.textBuffer.serialize())
    }
    this.router.respond(requestId, response.serializeBinary())
    this.siteIdsByPeerId.set(senderId, siteId)
  }

  receiveUpdate ({message}) {
    const updateMessage = Messages.PortalUpdate.deserializeBinary(message)

    if (updateMessage.hasTextEditorSwitch()) {
      this.receiveTextEditorSwitch(updateMessage.getTextEditorSwitch())
    } else if (updateMessage.hasSiteDisconnection()) {
      this.receiveSiteDisconnection(updateMessage.getSiteDisconnection())
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

  receiveSiteDisconnection (siteDisconnection) {
    const siteId = siteDisconnection.getSiteId()
    this.textEditorsById.forEach((textEditor) => {
      textEditor.siteDidDisconnect(siteId)
    })
  }
}
