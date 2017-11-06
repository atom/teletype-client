const Pusher = require('pusher-js')
const {Disposable} = require('event-kit')
const Errors = require('./errors')

module.exports =
class PusherPubSubGateway {
  constructor ({key}) {
    this.channelsByName = new Map()
    this.subscriptionsCount = 0
    // Constructing a Pusher instance initiates a WebSocket connection, so we
    // disconnect immediately.
    this.pusherClient = new Pusher(key, {encrypted: true})
    this.disconnect()
  }

  async subscribe (channelName, eventName, callback) {
    if (this.subscriptionsCount === 0) await this.connect()

    channelName = channelName.replace(/\//g, '.')
    let channel = this.channelsByName.get(channelName)
    if (!channel) {
      channel = this.pusherClient.subscribe(channelName)
      await new Promise((resolve, reject) => {
        channel.bind('pusher:subscription_succeeded', resolve)
        channel.bind('pusher:subscription_error', reject)
      })
      this.channelsByName.set(channelName, channel)
    }

    channel.bind(eventName, callback)
    this.subscriptionsCount++

    return new Disposable(() => {
      channel.unbind(eventName, callback)

      this.subscriptionsCount--
      if (this.subscriptionsCount === 0) this.disconnect()
    })
  }

  connect () {
    const error = new Errors.PubSubConnectionError('Error establishing web socket connection to signaling server')
    this.pusherClient.connect()
    return new Promise((resolve, reject) => {
      const handleConnection = () => {
        this.pusherClient.connection.unbind('connected', handleConnection)
        this.pusherClient.connection.unbind('error', handleError)
        resolve()
      }

      const handleError = () => {
        this.pusherClient.connection.unbind('connected', handleConnection)
        this.pusherClient.connection.unbind('error', handleError)
        reject(error)
      }

      this.pusherClient.connection.bind('connected', handleConnection)
      this.pusherClient.connection.bind('error', handleError)
    })
  }

  disconnect () {
    this.channelsByName.forEach((channel) => {
      this.pusherClient.unsubscribe(channel)
    })
    this.channelsByName.clear()
    this.pusherClient.disconnect()
  }
}
