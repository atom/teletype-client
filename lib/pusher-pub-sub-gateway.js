const Pusher = require('pusher-js')
const {Disposable} = require('event-kit')

module.exports =
class PusherPubSubGateway {
  constructor ({key}) {
    this.pusherClient = new Pusher(key, {encrypted: true})
    this.channelsByName = new Map()
  }

  async subscribe (channelName, eventName, callback) {
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
    return new Disposable(() => {
      channel.unbind(eventName, callback)
    })
  }
}
