const SharedBuffer = require('./shared-buffer')
const SharedEditor = require('./shared-editor')
const PusherPubSubGateway = require('./pusher-pub-sub-gateway')
const RestGateway = require('./rest-gateway')

module.exports =
class RealTimeClient {
  constructor ({restGateway, pubSubGateway, pusherKey, baseURL}) {
    this.restGateway = restGateway || new RestGateway({baseURL})
    this.pubSubGateway = pubSubGateway || new PusherPubSubGateway({key: pusherKey})
  }

  async createSharedEditor ({sharedBuffer, selectionRanges}) {
    const sharedEditor = new SharedEditor({
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway
    })
    await sharedEditor.create({sharedBuffer, selectionRanges})
    return sharedEditor
  }

  async joinSharedEditor (sharedEditorId) {
    const sharedEditor = new SharedEditor({
      id: sharedEditorId,
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway
    })
    await sharedEditor.join()
    return sharedEditor
  }

  async createSharedBuffer ({uri, text}) {
    const sharedBuffer = new SharedBuffer({
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway
    })
    await sharedBuffer.create({uri, text})
    return sharedBuffer
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
