const Messages = require('./teletype-client_pb')

module.exports =
class EditorProxyMetadata {
  static deserialize (message) {
    return new EditorProxyMetadata({
      id: message.getId(),
      bufferProxyId: message.getBufferProxyId(),
      bufferProxyURI: message.getBufferProxyUri()
    })
  }

  constructor ({id, bufferProxyId, bufferProxyURI}) {
    this.id = id
    this.bufferProxyId = bufferProxyId
    this.bufferProxyURI = bufferProxyURI
  }

  serialize () {
    const message = new Messages.EditorProxyMetadata()
    message.setId(this.id)
    message.setBufferProxyId(this.bufferProxyId)
    message.setBufferProxyUri(this.bufferProxyURI)
    return message
  }
}
