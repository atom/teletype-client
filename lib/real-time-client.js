const SharedBuffer = require('./shared-buffer')
const PusherPubSubGateway = require('./pusher-pub-sub-gateway')
const RestGateway = require('./rest-gateway')

module.exports =
class RealTimeClient {
  constructor ({restGateway, pubSubGateway, pusherKey, baseURL}) {
    this.restGateway = restGateway || new RestGateway({baseURL})
    this.pubSubGateway = pubSubGateway || new PusherPubSubGateway({key: pusherKey})
  }

  createSharedBuffer ({uri, delegate}) {
    return SharedBuffer.create({
      delegate,
      uri,
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
