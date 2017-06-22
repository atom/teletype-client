const {HostPortal, GuestPortal} = require('./portal')
const PusherPubSubGateway = require('./pusher-pub-sub-gateway')
const RestGateway = require('./rest-gateway')
const NOOP = () => {}

module.exports =
class RealTimeClient {
  constructor ({restGateway, pubSubGateway, pusherKey, baseURL, heartbeatIntervalInMilliseconds, didCreateOrJoinPortal}) {
    this.restGateway = restGateway || new RestGateway({baseURL})
    this.pubSubGateway = pubSubGateway || new PusherPubSubGateway({key: pusherKey})
    this.heartbeatIntervalInMilliseconds = heartbeatIntervalInMilliseconds || (60 * 1000)
    this.didCreateOrJoinPortal = didCreateOrJoinPortal || NOOP
  }

  async createPortal () {
    const portal = new HostPortal({
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
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
