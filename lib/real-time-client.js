const {HostPortal, GuestPortal} = require('./portal')
const PusherPubSubGateway = require('./pusher-pub-sub-gateway')
const RestGateway = require('./rest-gateway')
const NOOP = () => {}

module.exports =
class RealTimeClient {
  constructor ({restGateway, pubSubGateway, pusherKey, baseURL, heartbeatIntervalInMilliseconds, didCreateOrJoinPortal}) {
    this.pusherKey = pusherKey
    this.restGateway = restGateway || new RestGateway({baseURL})
    this.pubSubGateway = pubSubGateway
    this.heartbeatIntervalInMilliseconds = heartbeatIntervalInMilliseconds || (60 * 1000)
    this.didCreateOrJoinPortal = didCreateOrJoinPortal || NOOP
  }

  async initialize () {
    if (!this.pubSubGateway) this.pubSubGateway = new PusherPubSubGateway({key: this.pusherKey})

    this.peerRegistry = new PeerRegistry({
      peerId: await this.getPeerId(),
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
      delegate: this
    })
  }

  getPeerId () {
    return this.pubSubGateway.getClientId()
  }

  didReceiveIncomingConnection (peer) {
    peer.onRequest((requestId, request) => {
      didReceiveRequest(peer, requestId, request)
    })
    peer.onNotification((notification) => {
      didReceiveRequest(peer, notification)
    })
  }

  didReceiveRequest (peer, requestId, request) {
    // what are they requesting


  }

  didReceiveNotification (peer, notification) {
    // what are they notifying

  }

  async createPortal () {
    const portal = new HostPortal({
      peerId: await this.pubSubGateway.getClientId(),
      restGateway: this.restGateway,
      heartbeatIntervalInMilliseconds: this.heartbeatIntervalInMilliseconds
    })
    await portal.create()
    this.didCreateOrJoinPortal(portal)
    return portal
  }

  async joinPortal (portalId) {
    const portal = new GuestPortal({
      id: portalId,
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
      heartbeatIntervalInMilliseconds: this.heartbeatIntervalInMilliseconds
    })
    await portal.join()
    this.didCreateOrJoinPortal(portal)
    return portal
  }
}
