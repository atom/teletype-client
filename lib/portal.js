const assert = require('assert')
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

    this.network = new StarOverlayNetwork({id, isHub: this.isHost, peerPool})
    this.router = new Router(this.network)

    if (this.isHost) {
      this.nextSiteId = 2
      this.nextBufferId = 1
      this.nextEditorId = 1
      this.router.onRequest(`/portals/${id}`, this.receiveSubscription.bind(this))
    }
  }

  dispose () {
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

    const activeBuffer = TextBuffer.deserialize(response.getActiveTextBuffer(), {
      router: this.router,
      siteId: this.siteId
    })
    this.textBuffersById.set(activeBuffer.id, activeBuffer)

    const activeTextEditor = TextEditor.deserialize(response.getActiveTextEditor(), {
      router: this.router,
      siteId: this.siteId,
      textBuffersById: this.textBuffersById
    })
    this.textEditorsById.set(activeTextEditor.id, activeTextEditor)

    this.activeTextEditor = activeTextEditor

    if (this.delegate) this.delegate.setActiveTextEditor(activeTextEditor)

    console.log('subscribed', this.siteId);
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

  serialize () {
    const portalMessage = new Messages.Portal()
    if (this.activeTextEditor) portalMessage.setActiveTextEditorId(this.activeTextEditor.id)
    return portalMessage
  }
}
