const PeerPool = require('./peer-pool')
const Portal = require('./portal')
const PusherPubSubGateway = require('./pusher-pub-sub-gateway')
const RestGateway = require('./rest-gateway')
const NOOP = () => {}

module.exports =
class RealTimeClient {
  constructor ({restGateway, pubSubGateway, testEpoch, pusherKey, baseURL, didCreateOrJoinPortal}) {
    this.pusherKey = pusherKey
    this.restGateway = restGateway || new RestGateway({baseURL})
    this.pubSubGateway = pubSubGateway
    this.testEpoch = testEpoch
    this.didCreateOrJoinPortal = didCreateOrJoinPortal || NOOP
  }

  async initialize () {
    if (!this.pubSubGateway) this.pubSubGateway = new PusherPubSubGateway({key: this.pusherKey})

    this.peerId = await this.pubSubGateway.getClientId()
    this.peerPool = new PeerPool({
      peerId: this.peerId,
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
      fragmentSize: 16 * 1024, // 16KB
      testEpoch: this.testEpoch
    })
    await this.peerPool.initialize()
  }

  async createPortal () {
    const {id} = await this.restGateway.post('/portals', {
      hostPeerId: this.peerId
    })

    const portal = new Portal({id, siteId: 1, peerPool: this.peerPool})
    this.didCreateOrJoinPortal(portal)

    return portal
  }

  async joinPortal (id) {
    const {hostPeerId} = await this.restGateway.get(`/portals/${id}`)

    const portal = new Portal({id, hostPeerId, peerPool: this.peerPool})
    await portal.join()
    this.didCreateOrJoinPortal(portal)

    return portal
  }
}
