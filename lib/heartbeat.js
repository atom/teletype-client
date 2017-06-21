const assert = require('assert')

module.exports =
class Heartbeat {
  constructor ({restGateway, portalId, siteId, intervalInMilliseconds}) {
    this.restGateway = restGateway
    this.portalId = portalId
    this.siteId = siteId
    this.intervalInMilliseconds = intervalInMilliseconds
    this.intervalId = null
    this.pendingThumps = 0
  }

  start () {
    this.intervalId = setInterval(() => this.thump(), this.heartbeatIntervalInMilliseconds)
  }

  dispose () {
    assert(!this.resolveDisposePromise, 'Cannot dispose the heartbeat more than once')

    clearInterval(this.intervalId)
    this.intervalId = null
    return new Promise((resolve) => {
      if (this.pendingThumps === 0) {
        resolve()
      } else {
        this.resolveDisposePromise = resolve
      }
    })
  }

  async thump () {
    const promise = this.restGateway.post(`/portals/${this.portalId}/sites/${this.siteId}/heartbeats`)
    this.pendingThumps++
    await promise
    this.pendingThumps--
    if (this.resolveDisposePromise && this.pendingThumps === 0) this.resolveDisposePromise()
  }
}
