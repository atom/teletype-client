const SharedBuffer = require('./shared-buffer')

module.exports =
class RealTimeClient {
  constructor ({restGateway, pubSubGateway}) {
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
  }

  createSharedBuffer (delegate) {
    return SharedBuffer.create({
      delegate,
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway
    })
  }

  joinSharedBuffer (id, delegate) {
    return SharedBuffer.join({
      id,
      delegate,
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway
    })
  }
}
