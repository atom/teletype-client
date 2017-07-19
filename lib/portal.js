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
        this.router.onRequest(`/portals/${id}`, this.receiveSubscription.bind(this))
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

  createTextBuffer (props) {
    return new TextBuffer(Object.assign({
      id: this.nextBufferId++,
      siteId: this.siteId,
      router: this.router
    }, props))
  }

  createTextEditor (props) {
    return new TextEditor(Object.assign({
      id: this.nextEditorId++,
      siteId: this.siteId,
      router: this.router
    }, props))
  }

  setActiveTextEditor (textEditor) {
    assert(this.isHost, 'Only the host can set the active text editor')
    this.activeTextEditor = textEditor

    const updateMessage = new Messages.PortalUpdate()
    if (this.activeTextEditor) {
      updateMessage.setActiveTextBufferId(this.activeTextEditor.textBuffer.id)
      updateMessage.setActiveTextEditorId(this.activeTextEditor.id)
    }

    this.router.notify(`/portals/${this.id}`, updateMessage.serializeBinary())
  }

  receiveSubscription ({requestId}) {
    const response = new Messages.PortalSubscriptionResponse()
    response.setSiteId(this.nextSiteId++)
    if (this.activeTextEditor) {
      response.setActiveTextEditor(this.activeTextEditor.serialize())
      response.setActiveTextBuffer(this.activeTextEditor.textBuffer.serialize())
    }
    this.router.respond(requestId, response.serializeBinary())
  }

  async receiveUpdate ({message}) {
    const updateMessage = Messages.PortalUpdate.deserializeBinary(message)

    const textBufferId = updateMessage.getActiveTextBufferId()
    if (textBufferId && !this.textBuffersById.has(textBufferId)) {
      const response = await this.router.request(this.hostPeerId, `/buffers/${textBufferId}`)
      const textBufferMessage = Messages.TextBuffer.deserializeBinary(response)
      const textBuffer = TextBuffer.deserialize(textBufferMessage, {
        router: this.router,
        siteId: this.siteId
      })
      this.textBuffersById.set(textBufferId, textBuffer)
    }

    const textEditorId = updateMessage.getActiveTextEditorId()
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
}
