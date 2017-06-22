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
    this.intervalId = setInterval(() => this.thump(), this.intervalInMilliseconds)
  }

  dispose () {
    if (!this.disposePromise) {
      clearInterval(this.intervalId)
      this.intervalId = null
      this.disposePromise = new Promise((resolve) => {
        if (this.pendingThumps === 0) {
          resolve()
        } else {
          this.resolveDisposePromise = resolve
        }
      })
    }

    return this.disposePromise
  }

  async thump () {
    const promise = this.restGateway.post(`/portals/${this.portalId}/sites/${this.siteId}/heartbeats`)
    this.pendingThumps++
    await promise
    this.pendingThumps--
    if (this.resolveDisposePromise && this.pendingThumps === 0) this.resolveDisposePromise()
  }
}
