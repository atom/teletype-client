const Messages = require('./teletype-client_pb')
const {CompositeDisposable} = require('event-kit')
const NOOP = () => {}

module.exports =
class EditorProxyMetadata {
  static deserialize (message, props) {
    return new EditorProxyMetadata(Object.assign({
      id: message.getId(),
      bufferProxyId: message.getBufferProxyId(),
      bufferProxyURI: message.getBufferProxyUri()
    }, props))
  }

  constructor ({id, bufferProxyId, bufferProxyURI, siteId, router, didDispose}) {
    this.id = id
    this.bufferProxyId = bufferProxyId
    this.bufferProxyURI = bufferProxyURI
    this.subscriptions = new CompositeDisposable()
    this.didDispose = didDispose || NOOP
    if (didDispose) {
      this.subscriptions.add(
        router.onNotification(`/editors/${id}/disposal`, this.dispose.bind(this))
      )
    }
  }

  dispose () {
    this.subscriptions.dispose()
    this.didDispose()
  }

  serialize () {
    const message = new Messages.EditorProxyMetadata()
    message.setId(this.id)
    message.setBufferProxyId(this.bufferProxyId)
    message.setBufferProxyUri(this.bufferProxyURI)
    return message
  }
}
