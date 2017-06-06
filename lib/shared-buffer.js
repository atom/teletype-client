const DocumentReplica = require('tachyon')

module.exports =
class SharedBuffer {
  static async create ({delegate, restGateway, pubSubGateway}) {
    const siteId = 1
    const replica = new DocumentReplica(siteId)
    const operation = replica.insertLocal({position: 0, text: delegate.getText()})
    const {id} = await restGateway.post('/shared-buffers', {operations: [operation]})
    const sharedBuffer = new SharedBuffer({
      restGateway, pubSubGateway, delegate,
      siteId, id, replica
    })
    await sharedBuffer.subscribe()
    return sharedBuffer
  }

  static async join ({restGateway, pubSubGateway, id, delegate}) {
    const sharedBuffer = new SharedBuffer({restGateway, pubSubGateway, delegate, id})
    await sharedBuffer.join()
    return sharedBuffer
  }

  constructor ({restGateway, pubSubGateway, delegate, siteId, id, replica}) {
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.delegate = delegate
    this.id = id
    this.siteId = siteId
    this.replica = replica
    this.deferredOperations = []
    this.appliedOperationIds = new Set()
  }

  async join () {
    await this.subscribe()
    const {siteId, operations} = await this.restGateway.post(`/shared-buffers/${this.id}/sites`)
    this.replica = new DocumentReplica(siteId)
    this.applyRemoteOperations(operations)
    this.applyRemoteOperations(this.deferredOperations)
    this.deferredOperations = null
    this.delegate.setText(this.replica.getText())
  }

  async subscribe () {
    this.subscription = await this.pubSubGateway.subscribe(
      `/shared-buffers/${this.id}`,
      'operations',
      this.receive.bind(this)
    )
  }

  receive (operations) {
    if (this.replica) {
      this.applyRemoteOperations(operations)
    } else {
      this.deferredOperations.push(...operations)
    }
  }

  apply (op) {
    return this.applyMany([op])
  }

  applyMany (operations) {
    const opsToSend = []
    for (let i = operations.length - 1; i >= 0; i--) {
      const op = operations[i]
      const opToSend = this.replica.applyLocal(op)
      const opId = opIdToString(opToSend.opId)
      this.appliedOperationIds.add(opId)
      opsToSend.push(opToSend)
    }
    return this.restGateway.post(
      `/shared-buffers/${this.id}/operations`,
      {operations: opsToSend}
    )
  }

  applyRemoteOperations (operations) {
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i]
      const opId = opIdToString(op.opId)
      if (!this.appliedOperationIds.has(opId)) {
        const opsToApply = this.replica.applyRemote(operations[i])
        this.appliedOperationIds.add(opId)
        this.delegate.applyMany(opsToApply)
      }
    }
  }
}

function opIdToString (opId) {
  return `${opId.site}.${opId.seq}`
}
