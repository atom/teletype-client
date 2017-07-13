const {CompositeDisposable, Emitter} = require('event-kit')
const {RouterMessage} = require('./real-time_pb')

module.exports =
class Router {
  constructor (network) {
    this.network = network
    this.emitter = new Emitter()
    this.subscriptions = new CompositeDisposable()
    this.subscriptions.add(network.onReceive(this.receive.bind(this)))
  }

  notify (channelId, message) {
    if (!(message instanceof Buffer)) {
      message = Buffer.from(message)
    }

    const notification = new RouterMessage.Notification()
    notification.setBody(message)
    const routerMessage = new RouterMessage()
    routerMessage.setChannelId(channelId)
    routerMessage.setNotification(notification)
    this.network.broadcast(routerMessage.serializeBinary())
  }

  onNotification (channelId, callback) {
    return this.emitter.on('notification:' + channelId, callback)
  }

  receive ({senderId, message}) {
    const routerMessage = RouterMessage.deserializeBinary(message)
    const channelId = routerMessage.getChannelId()
    if (routerMessage.hasNotification()) {
      this.emitter.emit(
        'notification:' + channelId,
        {senderId, message: Buffer.from(routerMessage.getNotification().getBody())}
      )
    } else {
      throw new Error('Unsupported router message variant')
    }
  }
}
