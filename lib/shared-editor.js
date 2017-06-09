const SharedBuffer = require('./shared-buffer')
const {serializeRemotePosition, deserializeRemotePosition} = require('@atom-team/tachyon')

module.exports =
class SharedEditor {
  constructor ({id, sharedBuffer, restGateway, pubSubGateway}) {
    this.id = id
    this.sharedBuffer = sharedBuffer
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
  }

  async create () {
    const {replica} = this.sharedBuffer
    const {id} = await this.restGateway.post(
      `/shared-editors`,
      {
        sharedBufferId: this.sharedBuffer.id
      }
    )
    this.id = id
  }

  async join () {
    const resourceName = `/shared-editors/${this.id}`
    this.subscription = await this.pubSubGateway.subscribe(
      resourceName,
      'update',
      this.receiveUpdate.bind(this)
    )
    const {sharedBufferId} = await this.restGateway.get(resourceName)
    this.sharedBuffer = new SharedBuffer({
      id: sharedBufferId,
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway
    })
    await this.sharedBuffer.join()
  }

  setDelegate (delegate) {
    this.delegate = delegate
  }

  receiveUpdate ({scrollPosition}) {
  }
}
